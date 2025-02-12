// backend/src/services/chat/chatService.js
import firestore from '../db/firestore.js';
import geminiService from '../AI/gemini.js';
import vectorStorage from '../storage/vectors.js';
import { v4 as uuidv4 } from 'uuid';

class ChatService {
    constructor() {
        this.contextWindowSize = 10;
    }

    async processMessage(userId, message, conversationId) {
        try {
            console.log('Processing message for user:', userId);
            console.log('Message content:', message);
            // If no conversationId is provided, generate a new one.
            if (!conversationId) {
                conversationId = uuidv4();
            }
            // 1. Save user message with conversationId
            const userMessage = await firestore.saveChatMessage({
                userId,
                conversationId, // include conversationId here
                content: message,
                role: 'user'
            });
            console.log('User message saved:', userMessage);
    
            // 2. Get recent chat history (for context)
            const history = await this.getRecentHistory(userId);
            console.log('Retrieved chat history:', history.length, 'messages');
    
            // 3. Generate embeddings for the query
            console.log('Generating embeddings for query...');
            const queryEmbeddings = await geminiService.generateEmbeddings(message);
            console.log('Query embeddings generated, length:', queryEmbeddings.length);
    
            // 4. Search for relevant documents
            console.log('Searching vector store...');
            const relevantDocs = await vectorStorage.searchVectors(queryEmbeddings, 3);
            console.log('Found relevant documents:', relevantDocs.length);
    
            // 5. Check top doc similarity to decide if we should use context
            const topDoc = relevantDocs[0];
            const MIN_SIMILARITY = 0.8;
            let relevantContext = '';
            if (topDoc && topDoc.similarity >= MIN_SIMILARITY) {
                relevantContext = relevantDocs
                    .filter(doc => doc.similarity > 0.7)
                    .map(doc => {
                        console.log('Document similarity:', doc.similarity);
                        return `Context from document ${doc.metadata.documentId}:\n${doc.metadata.text}`;
                    })
                    .join('\n\n');
                console.log('Prepared context length:', relevantContext.length);
            } else {
                console.log('Skipping document context (no doc above similarity threshold).');
            }
    
            // 6. Build the final prompt
            const prompt = this.buildPrompt(message, relevantContext);
            console.log('Built final prompt');
    
            // 7. Generate response using the prompt
            console.log('Generating response...');
            const response = await geminiService.generateResponse(prompt, history);
            console.log('Generated response:', response.content.substring(0, 100) + '...');
    
            // 8. Save assistant's response with conversationId
            const assistantMessage = await firestore.saveChatMessage({
                userId,
                conversationId, // include conversationId here as well
                content: response.content,
                role: 'assistant',
                context: relevantContext || null
            });
            console.log('Assistant message saved');
    
            return {
                conversationId,
                message: response.content,
                context: relevantContext
                    ? {
                        used: true,
                        count: relevantDocs.length,
                        relevance: relevantDocs.map(d => d.similarity)
                    }
                    : null
            };
    
        } catch (error) {
            console.error('Message processing error:', error);
            throw new Error(`Failed to process message: ${error.message}`);
        }
    }
    
      

    buildPrompt(message, context = '') {
        if (!context) {
            return `Question: ${message}\nAnswer: Please provide a detailed response to this question.`;
        }

        return `You are an AI assistant with access to relevant document context. Use this context to provide accurate and detailed responses.

Context Information:
${context}

Question: ${message}

Please provide a detailed response based on the context provided. If the context doesn't contain relevant information, say so and provide a general response.

Answer:`;
    }
     // NEW: Method to retrieve the full chat history with a custom limit
     async getChatHistory(userId, limit = 50) {
        try {
            console.log('getting chat history');
            const messages = await firestore.getUserChatHistory(userId, limit);
            console.log(messages);
            // Group messages by conversationId
            const grouped = messages.reduce((acc, msg) => {
                // Use the conversationId stored in the message or default to "default"
                const convId = msg.conversationId || "default";
                if (!acc[convId]) {
                    acc[convId] = [];
                }
                // Push the message details (you may sort later)
                acc[convId].push({
                    role: msg.role,
                    content: msg.content,
                    createdAt: msg.createdAt
                });
                return acc;
            }, {});
    
            // Convert the grouped object into an array of conversation objects.
            // Optionally, sort messages in each conversation by createdAt in ascending order.
            const conversations = Object.entries(grouped).map(([conversationId, msgs]) => ({
                id: conversationId,
                messages: msgs.sort((a, b) => a.createdAt - b.createdAt)
            }));
            return conversations;
        } catch (error) {
            console.error('Error getting chat history:', error);
            return [];
        }
    }
    

    async getRecentHistory(userId) {
        try {
            const messages = await firestore.getUserChatHistory(userId, this.contextWindowSize);
            return messages.reverse().map(msg => ({
                role: msg.role,
                content: msg.content
            }));
        } catch (error) {
            console.error('Error getting chat history:', error);
            return [];
        }
    }
}

export default new ChatService();