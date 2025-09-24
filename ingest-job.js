// file: ingest-job.js
import { config } from "dotenv";
import { Client } from "@notionhq/client";
import axios from "axios";
import * as cheerio from "cheerio";
import dayjs from "dayjs";

// Load environment variables from .env file
config();

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// Utilities
const clean = (s) => (s || "").trim().replace(/\s+/g, " ");
const todayISODate = () => dayjs().format("YYYY-MM-DD");

// Site detection
function detectSite(url) {
	if (/greenhouse\.io/.test(url)) return "greenhouse";
	if (/linkedin\.com\/jobs/.test(url)) return "linkedin";
	if (/indeed\.com\/viewjob/.test(url)) return "indeed";
	if (/handshake\.com/.test(url)) return "handshake";
	return "generic";
}

// Parsers — tuned for common structures; safe-fall back to generic
async function parseGreenhouse(html, url) {
	const $ = cheerio.load(html);
	return {
		company: clean($("meta[property='og:site_name']").attr("content")) || clean($(".company-name").text()) || "",
		position: clean($("h1.app-title, h1, .opening > h1").first().text()) || "",
		location: clean($(".location, .location-name, .opening .location").first().text()) || "",
		jobUrl: url,
		salary: "", // often absent on Greenhouse
		notes: clean($(".content, .opening .content").text()).slice(0, 1000), // short summary
	};
}

async function parseLinkedIn(html, url) {
	const $ = cheerio.load(html);
	return {
		company: clean($("a.topcard__org-name-link, span.topcard__flavor").first().text()),
		position: clean($("h1.top-card-layout__title, h1.topcard__title").first().text()),
		location: clean($("span.topcard__flavor--bullet, span.topcard__flavor").last().text()),
		jobUrl: url,
		salary: "", // LI often hides it
		notes: clean($("div.show-more-less-html__markup").text()).slice(0, 1000),
	};
}

async function parseIndeed(html, url) {
	const $ = cheerio.load(html);
	return {
		company: clean($("div.jobsearch-CompanyInfoWithoutHeaderImage > div a, div.jobsearch-CompanyInfoContainer a").first().text()) || clean($("[data-company-name='true']").first().text()),
		position: clean($("h1.jobsearch-JobInfoHeader-title").first().text()),
		location: clean($("div.jobsearch-CompanyInfoWithoutHeaderImage div").eq(1).text()) || clean($("div.jobsearch-CompanyInfoContainer div").eq(1).text()),
		jobUrl: url,
		salary: clean($("div.salary-snippet-container, span.attribute_snippet").first().text()),
		notes: clean($("div#jobDescriptionText").text()).slice(0, 1000),
	};
}

async function parseHandshake(html, url) {
	const $ = cheerio.load(html);
	return {
		company: clean($("a[href*='/employers/'], [data-testid='employer-name']").first().text()),
		position: clean($("h1, [data-testid='job-title']").first().text()),
		location: clean($("[data-testid='job-location'], [data-testid='location']").first().text()),
		jobUrl: url,
		salary: clean($("div:contains('Compensation'), div:contains('Salary')").next().text()),
		notes: clean($("[data-testid='job-description']").text()).slice(0, 1000),
	};
}

async function parseGeneric(html, url) {
	const $ = cheerio.load(html);
	return {
		company: clean($("meta[name='og:site_name']").attr("content")) || clean($("meta[property='og:site_name']").attr("content")) || "",
		position: clean($("h1").first().text()),
		location: "",
		jobUrl: url,
		salary: "",
		notes: clean($("p, div").text()).slice(0, 600),
	};
}

async function scrape(url) {
	const res = await axios.get(url, {
		headers: {
			"User-Agent": "Mozilla/5.0 (compatible; JobIngest/1.0)",
		},
	});
	const html = res.data;
	const site = detectSite(url);
	if (site === "greenhouse") return parseGreenhouse(html, url);
	if (site === "linkedin") return parseLinkedIn(html, url);
	if (site === "indeed") return parseIndeed(html, url);
	if (site === "handshake") return parseHandshake(html, url);
	return parseGeneric(html, url);
}

// Notion helpers
async function findRowByJobUrl(jobUrl) {
	const resp = await notion.databases.query({
		database_id: DATABASE_ID,
		filter: {
			property: "Job URL",
			url: { equals: jobUrl },
		},
		page_size: 1,
	});
	return resp.results[0];
}

function propsFromParsed(p) {
	return {
		"Company Name": { title: [{ text: { content: p.company || p.position || "Job" } }] },
		"Position": { rich_text: [{ text: { content: p.position || "" } }] },
		"Location": { rich_text: [{ text: { content: p.location || "" } }] },
		"Job URL": { url: p.jobUrl || "" },
		"Salary": { rich_text: [{ text: { content: p.salary || "" } }] },
		"Notes": { rich_text: [{ text: { content: p.notes || "" } }] },
		"Status": { status: { name: p.status || "Not Started" } },
		"Applied Date": p.appliedDate
			? { date: { start: p.appliedDate } }
			: undefined,
		"Applied": p.appliedDate ? { checkbox: true } : undefined,
	};
}

async function upsertJob(url, options = {}) {
	const parsed = await scrape(url);

	// Basic heuristics
	const status = options.status || "Not Started";
	const appliedDate = options.applied ? (options.appliedDate || todayISODate()) : undefined;

	const page = await findRowByJobUrl(url);
	const properties = propsFromParsed({ ...parsed, status, appliedDate });

	if (page) {
		await notion.pages.update({ page_id: page.id, properties });
		return { action: "updated", id: page.id };
	} else {
		const resp = await notion.pages.create({
			parent: { database_id: DATABASE_ID },
			properties,
		});
		return { action: "created", id: resp.id };
	}
}

// CLI usage: node ingest-job.js "<URL>" [--applied] [--status="Applied"] [--appliedDate="YYYY-MM-DD"]
const args = process.argv.slice(2);
if (args[0]) {
	const url = args[0];
	const applied = args.includes("--applied");
	const statusArg = args.find(a => a.startsWith("--status="));
	const appliedDateArg = args.find(a => a.startsWith("--appliedDate="));
	const status = statusArg ? statusArg.split("=")[1] : undefined;
	const appliedDate = appliedDateArg ? appliedDateArg.split("=")[1] : undefined;

	upsertJob(url, { applied, status, appliedDate })
		.then((r) => console.log(r))
		.catch((e) => {
			console.error(e.response?.data || e.message);
			process.exit(1);
		});
} else {
	console.log('Usage: node ingest-job.js "<JOB_URL>" [--applied] [--status="Applied"] [--appliedDate="2025-09-23"]');
}