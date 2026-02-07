// Import required packages
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

// Load environment variables from .env file
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Google Gemini client with API key from environment variables
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Configure multer for file uploads (store in memory as buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only PDF, DOCX, and TXT files
    const allowedTypes = ['.pdf', '.docx', '.txt'];
    const fileExt = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (allowedTypes.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOCX, and TXT files are allowed.'));
    }
  }
});

// Middleware: Enable CORS for requests from multiple origins
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    
    // List of allowed origins
    const allowedOrigins = [
      'http://localhost:5173',
      'https://lovable.dev',
      'https://fb974799-ea5e-4d7f-b7d5-59fd6e909e7d.lovableproject.com',
      'https://job-matcher-backend-production-4600.up.railway.app'
    ];
    
    // Check if origin is in allowed list or is a Lovable subdomain
    const isLovableSubdomain = origin.match(/^https:\/\/[a-zA-Z0-9-]+\.lovable\.dev$/);
    const isLovableProject = origin.match(/^https:\/\/[a-zA-Z0-9-]+\.lovableproject\.com$/);
    
    if (allowedOrigins.includes(origin) || isLovableSubdomain || isLovableProject) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'multipart/form-data'],
  exposedHeaders: ['Content-Type']
}));

// Middleware: Parse JSON request bodies
app.use(express.json());

// ==============================================
// Helper Functions: File Text Extraction
// ==============================================

/**
 * Extract text from a PDF file buffer
 */
async function extractTextFromPDF(buffer) {
  try {
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    throw new Error(`Failed to extract text from PDF: ${error.message}`);
  }
}

/**
 * Extract text from a DOCX file buffer
 */
async function extractTextFromDOCX(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    throw new Error(`Failed to extract text from DOCX: ${error.message}`);
  }
}

/**
 * Extract text from a TXT file buffer
 */
function extractTextFromTXT(buffer) {
  try {
    return buffer.toString('utf-8');
  } catch (error) {
    throw new Error(`Failed to extract text from TXT: ${error.message}`);
  }
}

/**
 * Extract text from uploaded file based on file type
 */
async function extractTextFromFile(file) {
  const fileExt = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
  
  switch (fileExt) {
    case '.pdf':
      return await extractTextFromPDF(file.buffer);
    case '.docx':
      return await extractTextFromDOCX(file.buffer);
    case '.txt':
      return extractTextFromTXT(file.buffer);
    default:
      throw new Error(`Unsupported file type: ${fileExt}`);
  }
}

// ==============================================
// ENDPOINT 1: Health Check
// ==============================================
// Simple endpoint to verify the server is running
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ==============================================
// ENDPOINT 2: Analyze Resume
// ==============================================
// Accepts resume file (PDF, DOCX, TXT) OR plain text
// Uses Gemini to extract key information and generate follow-up questions
app.post('/api/analyze-resume', upload.single('file'), async (req, res) => {
  try {
    let resumeText = '';

    // Check if a file was uploaded
    if (req.file) {
      console.log(`Processing uploaded file: ${req.file.originalname}`);
      try {
        resumeText = await extractTextFromFile(req.file);
        console.log(`Successfully extracted ${resumeText.length} characters from file`);
      } catch (fileError) {
        return res.status(400).json({
          error: 'Failed to process uploaded file',
          message: fileError.message
        });
      }
    } 
    // If no file, check for text in request body
    else if (req.body.resumeText) {
      resumeText = req.body.resumeText;
      console.log('Processing resume text from request body');
    }

    // Validate that we have resume text from either source
    if (!resumeText || resumeText.trim().length === 0) {
      return res.status(400).json({
        error: 'Resume text or file is required',
        message: 'Please provide either a resume file (PDF, DOCX, TXT) or resume text in the request body'
      });
    }

    // Check if API key is configured
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY not configured in .env file'
      });
    }

    console.log('Analyzing resume with Gemini...');

    // Get Gemini model
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

    // Call Gemini API to analyze the resume
    const result = await model.generateContent(`You are a career counselor analyzing a resume. Please analyze the following resume and extract key information.

Resume:
${resumeText}

Please provide your response in the following JSON format (return ONLY valid JSON, no markdown or extra text):
{
  "analysis": {
    "name": "Full name of the candidate (or 'Not specified' if not found)",
    "currentRole": "Current or most recent job title",
    "skills": ["skill1", "skill2", "skill3", ...],
    "experience": "Brief summary of their work experience (2-3 sentences)",
    "education": "Highest degree or most relevant education"
  },
  "questions": [
    "Question 1 - ALWAYS about career pivot/continuation",
    "Question 2 - contextual follow-up",
    "Question 3 - contextual follow-up",
    "Question 4 - contextual follow-up",
    "Question 5 - contextual follow-up"
  ]
}

IMPORTANT: Generate exactly 5 conversational, natural questions (not robotic) to deeply understand their career goals:

1. FIRST QUESTION (always use this exact question): "Are you looking to continue in your current career path, or are you interested in pivoting to a different field or role? If pivoting, what direction interests you?"

2-5. FOLLOW-UP QUESTIONS (tailor these based on the resume):
   - If the candidate appears to be senior (10+ years experience, leadership roles, or management experience): Ask about their preference for leadership roles vs individual contributor roles
   - Ask about their location preferences (remote, hybrid, in-person, willing to relocate)
   - Ask about company type preferences (startup, established company, enterprise, nonprofit, etc.)
   - Ask about industry preferences or if they're open to switching industries
   - Ask what matters most to them (career growth, job stability, company mission, work-life balance, compensation, etc.)

Make questions 2-5 conversational and specific to their background. The goal is to match them with the RIGHT jobs, not just any jobs.`);

    // Extract the text response from Gemini
    const response = result.response;
    const responseText = response.text();

    // Parse the JSON response from Gemini
    let parsedResult;
    try {
      parsedResult = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', responseText);
      return res.status(500).json({
        error: 'Failed to parse AI response',
        details: responseText
      });
    }

    // Return the structured analysis and questions
    res.json(parsedResult);

  } catch (error) {
    // Handle any errors that occur during the API call
    console.error('Error analyzing resume:', error.message);
    res.status(500).json({
      error: 'Failed to analyze resume',
      message: error.message
    });
  }
});

// ==============================================
// Start the Server
// ==============================================
app.listen(PORT, () => {
  console.log(`\n🚀 Job Matcher Backend is running!`);
  console.log(`📍 Server: http://localhost:${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
  console.log(`📄 Analyze resume: POST http://localhost:${PORT}/api/analyze-resume\n`);

  // Remind user to set up API key if not configured
  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️  WARNING: GEMINI_API_KEY not found in .env file');
    console.warn('   Please add your API key to the .env file\n');
  }
});
