// backend/src/services/storage/documents.js

import { Storage } from '@google-cloud/storage';
import { v4 as uuidv4 } from 'uuid';
import firestore from '../db/firestore.js';
import vectorStorage from './vectors.js';
import geminiService from '../AI/gemini.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

class DocumentService {
    constructor() {
        this.storage = new Storage({
            keyFilename: process.env.GOOGLE_CLOUD_KEY_PATH,
            projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
        });
        this.bucketName = process.env.GOOGLE_CLOUD_BUCKET;
        this.bucket = this.storage.bucket(this.bucketName);
    }

    async verifyAdmin(userId) {
        const user = await firestore.getUser(userId);
        if (!user || user.role !== 'admin') {
            throw new Error('Unauthorized: Admin access required');
        }
        return user;
    }

    async uploadDocument(file, adminId, metadata = {}) {
        try {
            const fileName = `documents/${uuidv4()}-${file.originalname}`;
            const blob = this.bucket.file(fileName);
            console.log('Starting Uploading')
    
            const blobStream = blob.createWriteStream({
                metadata: {
                    contentType: file.mimetype,
                    metadata: {
                        originalName: file.originalname,
                        uploadedBy: adminId || 'anonymous', // Add default value
                        ...metadata
                    }
                }
            });
            console.log('File Uploading')
            console.log(fileName)
            
            return new Promise((resolve, reject) => {
                blobStream.on('error', (error) => {
                    console.log('Blob Stream Error:', error); // Add this
                    reject(error);
                });
                
                blobStream.on('finish', async () => {
                    try {
                        const [url] = await blob.getSignedUrl({
                            action: 'read',
                            expires: Date.now() + 3600000
                        });
                
                        const document = await firestore.createDocument({
                            name: file.originalname,
                            type: file.mimetype,
                            size: file.size,
                            url,
                            fileName,
                            metadata
                        }, adminId || 'anonymous');
                        
                        if (file.mimetype.includes('text') || file.mimetype.includes('pdf')) {
                            await this.processDocumentVectors(document.id, file.buffer, file.mimetype);
                            const updatedDoc = await firestore.db.collection('documents').doc(document.id).get();
                            resolve({ status: 200, data: { id: updatedDoc.id, ...updatedDoc.data() } });
                            return;
                        }
                
                        resolve({ status: 200, data: document });
                    } catch (error) {
                        console.error('Document upload error:', error);
                        reject(error);
                    }
                });
    
                blobStream.end(file.buffer);
            });
    
        } catch (error) {
            console.error('Document upload error:', error);
            throw new Error(`Failed to upload document: ${error.message}`);
        }
    }

    async processDocumentVectors(documentId, buffer, mimetype) {
        try {
            let text;
            if (mimetype === 'application/pdf') {
                console.log('Processing PDF document...');
                const pdfData = await pdfParse(buffer);
                text = pdfData.text;
                console.log('PDF text extraction successful');
                console.log('PDF text length:', text.length);
                console.log('First 200 characters:', text.substring(0, 200));
            } else {
                text = buffer.toString('utf-8');
            }
            
            if (!text) {
                throw new Error('No text content could be extracted from document');
            }
    
            console.log('Starting embedding generation...');
            const embeddings = await geminiService.generateEmbeddings(text);
            console.log('Embeddings generated successfully');
            
            console.log('Storing vectors...');
            await vectorStorage.storeVectors([embeddings], {
                documentId,
                text
            });
            console.log('Vectors stored successfully');
    
            await firestore.db.collection('documents').doc(documentId).update({
                vectorized: true,
                vectorizedAt: new Date()
            });
            console.log('Document marked as vectorized');
        } catch (error) {
            console.error('Document vectorization error:', error);
            await firestore.db.collection('documents').doc(documentId).update({
                vectorized: false,
                vectorError: error.message
            });
        }
    }


    async deleteDocument(documentId, adminId) {
        try {
            // Verify admin status
            // await this.verifyAdmin(adminId);

            // Get document info
            const doc = await firestore.db.collection('documents').doc(documentId).get();
            if (!doc.exists) {
                throw new Error('Document not found');
            }

            const { fileName } = doc.data();

            // Delete from Cloud Storage
            await this.bucket.file(fileName).delete();

            // Delete vectors
            await vectorStorage.deleteVectorsByDocument(documentId);

            // Mark document as deleted in Firestore
            await firestore.deleteDocument(documentId, adminId);

        } catch (error) {
            console.error('Document deletion error:', error);
            throw new Error(`Failed to delete document: ${error.message}`);
        }
    }

    async getSignedUrl(fileName, adminId) {
        try {
            // await this.verifyAdmin(adminId);

            const [url] = await this.bucket.file(fileName).getSignedUrl({
                action: 'read',
                expires: Date.now() + 3600000 // 1 hour
            });
            
            return url;
        } catch (error) {
            console.error('URL generation error:', error);
            throw new Error('Failed to generate signed URL');
        }
    }
}

export default new DocumentService();