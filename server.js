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
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

    // Call Gemini API to analyze the resume
    const result = await model.generateContent(`You are an expert career counselor and resume analyst. Your task is to thoroughly analyze the provided resume and extract COMPREHENSIVE information.

RESUME TEXT:
${resumeText}

CRITICAL INSTRUCTIONS:
1. Extract EVERY skill mentioned in the resume - be exhaustive and include technical skills, soft skills, tools, languages, methodologies, certifications, and any other competencies mentioned
2. Provide a DETAILED experience summary covering the full arc of their career - include progression, key achievements, and scope of responsibility
3. Extract ALL education mentioned - degrees, certifications, relevant coursework, and continuous learning
4. Identify their career level (entry-level, mid-level, senior, manager, executive)
5. Generate exactly 5 SPECIFIC, CONVERSATIONAL questions designed to understand their career aspirations and match them with the RIGHT opportunities

Generate questions that are:
- Natural and conversational (like a real person talking)
- Specific to their background and experience level
- Designed to uncover career direction (pivot vs. continuation vs. advancement)
- Focused on preferences, values, and constraints
- Never generic or robotic

Format response as ONLY valid JSON (no markdown, no extra text):
{
  "analysis": {
    "name": "Full name (or 'Not specified')",
    "currentRole": "Most recent job title and company",
    "careerLevel": "entry-level|mid-level|senior|manager|executive",
    "skills": ["skill1", "skill2", "skill3", "skill4", "skill5", ... list ALL skills comprehensively],
    "experience": "Write 3-4 sentences providing a comprehensive overview of their entire career journey, key achievements, and progression. Include scope of work, industries, and any unique expertise.",
    "education": "List all degrees, certifications, and relevant educational achievements. Include institution and year if available."
  },
  "questions": [
    "Question 1 - About career direction/pivot (make it specific to their background)",
    "Question 2 - About role preferences (leadership vs individual contributor, or other role-specific preference)",
    "Question 3 - About work environment (remote, location, company size/type)",
    "Question 4 - About industry or domain preferences",
    "Question 5 - About values/priorities (what matters most in next role - growth, stability, mission, compensation, work-life balance, etc.)"
  ]
}

Remember: The questions should feel natural and tailored to their specific background, not generic templates.`);

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
// ENDPOINT 3: Match Jobs Based on User Preferences
// ==============================================
// Takes user's answers to career questions and generates personalized job matches
app.post('/api/match-jobs', express.json(), async (req, res) => {
  try {
    const { userProfile, userAnswers } = req.body;

    // Validate input
    if (!userProfile || !userAnswers) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Please provide userProfile and userAnswers'
      });
    }

    // Check if API key is configured
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY not configured in .env file'
      });
    }

    console.log('Matching jobs based on user preferences...');

    // Get Gemini model
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

    // Call Gemini API to generate job matches
    const result = await model.generateContent(`You are an expert career matching AI. Based on the candidate's profile and their answers about career preferences, generate personalized job recommendations.

CANDIDATE PROFILE:
${JSON.stringify(userProfile, null, 2)}

CANDIDATE'S ANSWERS TO CAREER QUESTIONS:
${userAnswers.map((answer, index) => `Q${index + 1}: ${answer}`).join('\n')}

Your task:
1. Analyze the candidate's skills, experience, and career goals based on their answers
2. Identify their career direction (continuation, pivot, advancement)
3. Determine their ideal role characteristics, company environment, and location preferences
4. Generate 5-8 realistic, personalized job position recommendations with:
   - Job title that would be a good fit
   - Type of company/industry
   - Key responsibilities that leverage their strengths
   - Required vs. nice-to-have qualifications (mapped to their profile)
   - Estimated salary range (based on their experience level)
   - Why this role is a good fit for them based on their answers
   - Whether this represents a continuation, pivot, or advancement

Format as ONLY valid JSON (no markdown, no extra text):
{
  "careerAnalysis": {
    "detectedDirection": "continuation|pivot|advancement",
    "careerGoals": "Brief summary of what they're looking for based on answers",
    "keyStrengths": ["strength1", "strength2", "strength3"],
    "matchCriteria": {
      "roleType": "description of ideal roles",
      "industryPreferences": ["industry1", "industry2"],
      "workEnvironment": "description of preferred work environment based on answers",
      "locationPreferences": "description of location preferences based on answers"
    }
  },
  "jobMatches": [
    {
      "id": 1,
      "jobTitle": "Specific job title",
      "company": "Company type/example",
      "industry": "Industry",
      "roleType": "continuation|pivot|advancement",
      "keyResponsibilities": ["responsibility1", "responsibility2", "responsibility3"],
      "requiredQualifications": ["qual1", "qual2"],
      "niceToHave": ["nice1", "nice2"],
      "salaryRange": "$XXX,000-$XXX,000",
      "workSetup": "remote|hybrid|in-person",
      "whyGoodFit": "Explanation of why this role matches their profile and answers",
      "growthOpportunity": "What they could learn/achieve in this role"
    },
    ... (repeat for 5-8 positions)
  ],
  "nextSteps": [
    "Action 1 to take next",
    "Action 2 to prepare",
    "Action 3 for job search"
  ]
}

Make recommendations realistic and thoughtful - not generic. Reference specific skills and experiences from their profile.`);

    // Extract the text response
    const response = result.response;
    const responseText = response.text();

    // Parse the JSON response
    let parsedResult;
    try {
      parsedResult = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse Gemini job matching response:', responseText);
      return res.status(500).json({
        error: 'Failed to parse job matching response',
        details: responseText
      });
    }

    // Return the job matches and recommendations
    res.json(parsedResult);

  } catch (error) {
    // Handle any errors that occur during the API call
    console.error('Error matching jobs:', error.message);
    res.status(500).json({
      error: 'Failed to match jobs',
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
