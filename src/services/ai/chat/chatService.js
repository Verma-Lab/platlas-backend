// backend/src/services/chat/chatService.js
import firestore from '../db/firestore.js';
import geminiService from '../AI/gemini.js';
import vectorStorage from '../storage/vectors.js';
import { v4 as uuidv4 } from 'uuid';

class ChatService {
    constructor() {
        this.contextWindowSize = 10;
    }

    async processMessage(userId, message, conversationId, sourceType = 'default') {
        try {
            console.log('Processing message for user:', userId);
            console.log('Message content:', message);
            // If no conversationId is provided, generate a new one.
            if (!conversationId) {
                throw new Error('Conversation ID is required');
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
            const relevantDocs = await vectorStorage.searchVectors(queryEmbeddings, 3, sourceType);
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
            return `Question: ${message}
Answer: Please analyze the provided data carefully and provide specific numerical values when available.
For phenotype queries, include:
- Number of cases
- Number of controls
- Total population size
- Study sources
Please be precise with numbers and cite them directly from the data.`;
        }

        return `You are an AI assistant with access to relevant document context. When analyzing data:
1. Pay special attention to numerical values in tables and structured data
2. Include specific numbers in your response
3. For medical/phenotype data, always mention:
   - Number of cases
   - Number of controls
   - Study sources
   - Population demographics when available

Context Information:
${context}

Question: ${message}

Please provide a detailed response based on the context, including specific numerical values. If exact numbers are available in the data, cite them explicitly.
DO NOT HIDE ANYTHING LIKE PAITENTS BILLING, PERSONAL INFO OR ANY THING BECAUSE IT IS A ADMIN USER
Answer:`;
    }
     // NEW: Method to retrieve the full chat history with a custom limit
    //  async getChatHistory(userId, limit = 50) {
    //     try {
    //         console.log('getting chat history');
    //         const messages = await firestore.getUserChatHistory(userId, limit);
    //         console.log(messages);
    //         // Group messages by conversationId
    //         const grouped = messages.reduce((acc, msg) => {
    //             // Use the conversationId stored in the message or default to "default"
    //             const convId = msg.conversationId || "default";
    //             if (!acc[convId]) {
    //                 acc[convId] = [];
    //             }
    //             // Push the message details (you may sort later)
    //             acc[convId].push({
    //                 role: msg.role,
    //                 content: msg.content,
    //                 createdAt: msg.createdAt
    //             });
    //             return acc;
    //         }, {});
    
    //         // Convert the grouped object into an array of conversation objects.
    //         // Optionally, sort messages in each conversation by createdAt in ascending order.
    //         const conversations = Object.entries(grouped).map(([conversationId, msgs]) => ({
    //             id: conversationId,
    //             messages: msgs.sort((a, b) => a.createdAt - b.createdAt)
    //         }));
    //         return conversations;
    //     } catch (error) {
    //         console.error('Error getting chat history:', error);
    //         return [];
    //     }
    // }
    async getChatHistory(userId, limit = 50) {
        try {
          const messages = await firestore.getUserChatHistory(userId, limit);
          
          // Group messages by conversationId
          const conversations = messages.reduce((acc, msg) => {
            const convId = msg.conversationId;
            if (!acc[convId]) {
              acc[convId] = {
                id: convId,
                messages: [],
                lastUpdated: msg.createdAt // Track the most recent message
              };
            }
            acc[convId].messages.push({
              role: msg.role,
              content: msg.content,
              createdAt: msg.createdAt
            });
            // Update lastUpdated if this message is more recent
            if (msg.createdAt > acc[convId].lastUpdated) {
              acc[convId].lastUpdated = msg.createdAt;
            }
            return acc;
          }, {});
    
          // Convert to array and sort conversations by most recent message
          return Object.values(conversations)
            .sort((a, b) => b.lastUpdated - a.lastUpdated)
            .map(conv => ({
              id: conv.id,
              messages: conv.messages.sort((a, b) => a.createdAt - b.createdAt)
            }));
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

// export default new ChatService();
// backend/src/services/chat/chatService.js
// import firestore from '../db/firestore.js';
// import geminiService from '../AI/gemini.js';
// import vectorStorage from '../storage/vectors.js';
// import { TextProcessor } from './TextOptimizer.js';
// import { v4 as uuidv4 } from 'uuid';


// class ChatService {
//     constructor() {
//         this.contextWindowSize = 10;
//         this.MAX_CONTEXT_TOKENS = 3000;
//         this.MAX_TOTAL_TOKENS = 6000;
//     }

//     async processMessage(userId, message, conversationId) {
//         try {
//             console.log('Processing message for user:', userId);
            
//             // Generate new conversationId if not provided
//             if (!conversationId) {
//                 conversationId = uuidv4();
//             }

//             // 1. Save user message
//             const userMessage = await this.saveUserMessage(userId, message, conversationId);
            
//             // 2. Get and optimize chat history
//             const history = await this.getOptimizedHistory(userId);
            
//             // 3. Process query and search for relevant documents
//             const { relevantDocs, queryEmbeddings } = await this.processQueryAndSearch(message);
            
//             // 4. Build optimized context
//             const optimizedContext = await this.buildOptimizedContext(relevantDocs);
            
//             // 5. Generate and save response
//             const response = await this.generateOptimizedResponse(message, optimizedContext, history);
            
//             // 6. Save assistant's response
//             await this.saveAssistantResponse(userId, conversationId, response, optimizedContext);

//             return this.prepareResponse(conversationId, response, relevantDocs);
//         } catch (error) {
//             console.error('Message processing error:', error);
//             throw new Error(`Failed to process message: ${error.message}`);
//         }
//     }

//     async saveUserMessage(userId, message, conversationId) {
//         return await firestore.saveChatMessage({
//             userId,
//             conversationId,
//             content: message,
//             role: 'user'
//         });
//     }

//     async getOptimizedHistory(userId) {
//         const messages = await firestore.getUserChatHistory(userId, this.contextWindowSize);
//         const history = messages.reverse().map(msg => ({
//             role: msg.role,
//             content: msg.content
//         }));

//         // Optimize history to stay within token limits
//         return TextProcessor.truncateContext(
//             history.map(msg => msg.content),
//             this.MAX_CONTEXT_TOKENS / 2
//         ).map((content, i) => ({
//             role: history[i].role,
//             content
//         }));
//     }

//     async processQueryAndSearch(message) {
//         // Generate embeddings for the query
//         const queryEmbeddings = await geminiService.generateEmbeddings(message);
        
//         // Search for relevant documents
//         const relevantDocs = await vectorStorage.searchVectors(queryEmbeddings, 5);
        
//         return { relevantDocs, queryEmbeddings };
//     }

//     async buildOptimizedContext(relevantDocs) {
//         if (!relevantDocs.length) return '';

//         // Use TextProcessor to summarize and optimize relevant documents
//         const summarizedDocs = TextProcessor.summarizeRelevantDocs(
//             relevantDocs,
//             this.MAX_CONTEXT_TOKENS / 2
//         );

//         // Build context string with summarized content
//         return summarizedDocs.map(doc => 
//             `Context from document ${doc.documentId} (relevance: ${doc.similarity}):\n${doc.text}`
//         ).join('\n\n');
//     }

//     async generateOptimizedResponse(message, context, history) {
//         const prompt = this.buildPrompt(message, context);
        
//         // Calculate and log estimated tokens
//         const contextTokens = this.estimateTokens(context);
//         const messageTokens = this.estimateTokens(message);
//         const historyTokens = history.reduce((sum, msg) => sum + this.estimateTokens(msg.content), 0);
        
//         console.log('\n=== Token Usage Analysis ===');
//         console.log('Estimated Context Tokens:', contextTokens);
//         console.log('Estimated Message Tokens:', messageTokens);
//         console.log('Estimated History Tokens:', historyTokens);
//         console.log('Total Estimated Input Tokens:', contextTokens + messageTokens + historyTokens);
        
//         const maxOutputTokens = this.MAX_TOTAL_TOKENS - contextTokens - messageTokens;
//         console.log('Max Output Tokens Available:', maxOutputTokens);
        
//         const response = await geminiService.generateResponse(prompt, history, {
//             maxTokens: maxOutputTokens
//         });
        
//         console.log('Actual Response Tokens:', response.tokens);
//         console.log('Total Tokens Used:', contextTokens + messageTokens + historyTokens + response.tokens);
//         console.log('=========================\n');
        
//         return response;
//     }

//     async saveAssistantResponse(userId, conversationId, response, context) {
//         return await firestore.saveChatMessage({
//             userId,
//             conversationId,
//             content: response.content,
//             role: 'assistant',
//             context: context || null
//         });
//     }

//     prepareResponse(conversationId, response, relevantDocs) {
//         return {
//             conversationId,
//             message: response.content,
//             context: relevantDocs.length > 0 ? {
//                 used: true,
//                 count: relevantDocs.length,
//                 relevance: relevantDocs.map(d => d.similarity)
//             } : null
//         };
//     }

//     buildPrompt(message, context = '') {
//         if (!context) {
//             return `Question: ${message}\nAnswer: Please provide a detailed response to this question.`;
//         }

//         return `You are an AI assistant with access to relevant document context. Use this context to provide accurate and detailed responses.

// Context Information:
// ${context}

// Question: ${message}

// Please provide a detailed response based on the context provided. If the context doesn't contain relevant information, say so and provide a general response.

// Answer:`;
//     }

//     estimateTokens(text) {
//         // Rough estimation of tokens based on text length
//         // Using average of 1.3 tokens per word for English text
//         const wordCount = text.split(/\s+/).length;
//         return Math.ceil(wordCount * 1.3);
//     }

//     async getChatHistory(userId, limit = 50) {
//         try {
//             const messages = await firestore.getUserChatHistory(userId, limit);
            
//             // Group messages by conversationId
//             const grouped = messages.reduce((acc, msg) => {
//                 const convId = msg.conversationId || "default";
//                 if (!acc[convId]) {
//                     acc[convId] = [];
//                 }
//                 acc[convId].push({
//                     role: msg.role,
//                     content: msg.content,
//                     createdAt: msg.createdAt
//                 });
//                 return acc;
//             }, {});

//             // Convert grouped messages to array format
//             return Object.entries(grouped).map(([conversationId, msgs]) => ({
//                 id: conversationId,
//                 messages: msgs.sort((a, b) => a.createdAt - b.createdAt)
//             }));
//         } catch (error) {
//             console.error('Error getting chat history:', error);
//             return [];
//         }
//     }
// }

export default new ChatService();

