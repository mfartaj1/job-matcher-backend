# Job Matcher Backend

A Node.js/Express backend for a job matching application that uses Claude AI to analyze resumes.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file and add your Anthropic API key:
```
ANTHROPIC_API_KEY=your_actual_api_key_here
```

Get your API key from: https://console.anthropic.com/

3. Start the server:
```bash
npm start
```

The server will run on `http://localhost:3001`

## API Endpoints

### GET /api/health
Health check endpoint to verify the server is running.

**Response:**
```json
{
  "status": "ok"
}
```

### POST /api/analyze-resume
Analyzes a resume using Claude AI and extracts key information.

**Request Body:**
```json
{
  "resumeText": "Your resume text here..."
}
```

**Response:**
```json
{
  "analysis": {
    "name": "John Doe",
    "currentRole": "Software Engineer",
    "skills": ["JavaScript", "React", "Node.js"],
    "experience": "Summary of work experience...",
    "education": "Bachelor's in Computer Science"
  },
  "questions": [
    "What type of company culture do you thrive in?",
    "What are your salary expectations?",
    "Are you open to remote work?"
  ]
}
```

## CORS Configuration

The server is configured to accept requests from `http://localhost:5173` (Vite's default dev port).

## Tech Stack

- **Express**: Web framework
- **CORS**: Cross-origin resource sharing
- **dotenv**: Environment variable management
- **@anthropic-ai/sdk**: Claude AI integration
