// File: src/controllers/gptController.js
import { queryGPT, initializeDatabase } from '../services/gptService.js';

export async function askGPT(req, res) {
    try {
        const { question } = req.query;
        
        if (!question) {
            return res.status(400).json({ 
                error: 'Question parameter is required' 
            });
        }

        const response = await queryGPT(question);
        res.json(response);
    } catch (error) {
        console.error('Error in askGPT controller:', error);
        res.status(500).json({ 
            error: error.message 
        });
    }
}

export async function initDatabase(req, res) {
    try {
        await initializeDatabase();
        res.json({ 
            message: 'Database initialized successfully' 
        });
    } catch (error) {
        console.error('Error initializing database:', error);
        res.status(500).json({ 
            error: error.message 
        });
    }
}