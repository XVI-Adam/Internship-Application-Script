# 📥 Job Ingestor — Notion Job Tracker

A Node.js script that scrapes job postings from popular platforms and saves them into a Notion database.  
Supports **Greenhouse, LinkedIn, Indeed, Handshake**, plus a generic fallback.

---

## 🚀 Setup

# Install dependencies
    npm install axios cheerio dayjs dotenv @notionhq/client

# Create .env file
    cat <<EOF > .env
    NOTION_API_KEY=your_secret_notion_api_key
    NOTION_DATABASE_ID=your_database_id
    EOF

    Notion database properties (exact names):
    Company Name (title), Position, Location, Job URL, Salary, Notes, Status, Applied Date, Applied.
    💻 Usage
    
    node ingest-job.js "<JOB_URL>" [--applied] [--status="Applied"] [--appliedDate="YYYY-MM-DD"]

Examples

# Save a job
    node ingest-job.js "https://boards.greenhouse.io/company/jobs/12345"

# Mark as applied
    node ingest-job.js "https://linkedin.com/jobs/view/12345" --applied

# Custom status + applied date
    node ingest-job.js "https://indeed.com/viewjob?jk=12345" --status="Interview" --appliedDate="2025-09-23"

⚙️ How It Works

    Detects job site → scrapes with Cheerio

    Extracts details (company, position, location, salary, notes)

    Upserts into Notion (update if exists, create if new)

📜 Output

    { action: 'created', id: 'abc123' }
    { action: 'updated', id: 'abc123' }
