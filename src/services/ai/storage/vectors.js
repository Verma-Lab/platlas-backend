// backend/src/services/storage/vectors.js

import { VertexAI } from '@google-cloud/vertexai';
import firestore from '../db/firestore.js';

class VectorStorageService {
    constructor() {
        this.vertexai = new VertexAI({
            project: process.env.GOOGLE_CLOUD_PROJECT_ID,
            location: process.env.GOOGLE_CLOUD_REGION
        });
        this.vectorsCollection = 'document_vectors';
    }

    async storeVectors(vectors, metadata = {}) {
        try {
            if (!vectors || !Array.isArray(vectors)) {
                throw new Error('Vectors must be an array');
            }

            // Validate each vector
            vectors.forEach((vector, index) => {
                if (!Array.isArray(vector)) {
                    throw new Error(`Vector at index ${index} is not an array`);
                }
                if (!vector.every(val => typeof val === 'number' && !isNaN(val))) {
                    throw new Error(`Vector at index ${index} contains invalid values`);
                }
            });

            const batch = firestore.db.batch();
            const vectorRefs = [];

            vectors.forEach((vector, i) => {
                const vectorRef = firestore.db.collection(this.vectorsCollection).doc();
                vectorRefs.push(vectorRef.id);

                const docData = {
                    vector,
                    metadata: {
                        documentId: metadata.documentId,
                        chunk: i,
                        text: metadata.text,
                        createdAt: new Date(),
                        dimensions: vector.length
                    }
                };

                batch.set(vectorRef, docData);
            });

            await batch.commit();
            
            return {
                vectorIds: vectorRefs,
                count: vectors.length
            };
        } catch (error) {
            console.error('Vector storage error:', error);
            throw new Error(`Failed to store vectors: ${error.message}`);
        }
    }

async searchVectors(queryVector, limit = 5) {
    try {
        console.log('Starting vector search with query vector length:', queryVector.length);
        
        const snapshot = await firestore.db.collection(this.vectorsCollection).get();
        console.log('Retrieved vectors from Firestore:', snapshot.size);
        
        if (snapshot.empty) {
            console.log('No vectors found in storage');
            return [];
        }

        // Process vectors and calculate similarities
        const vectors = [];
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const vectorData = data.vector;

            if (!this.validateVector(vectorData, queryVector)) {
                console.log('Invalid vector found, skipping...');
                continue;
            }

            const similarity = this.enhancedCosineSimilarity(queryVector, vectorData);
            console.log('Calculated similarity:', similarity, 'for document:', data.metadata.documentId);
            
            vectors.push({
                id: doc.id,
                similarity,
                metadata: data.metadata
            });
        }

        // Sort by similarity and apply dynamic threshold
        const sortedVectors = vectors.sort((a, b) => b.similarity - a.similarity);
        let results = [];

        if (sortedVectors.length > 0) {
            const topSimilarity = sortedVectors[0].similarity;
            const dynamicThreshold = Math.max(0.3, topSimilarity * 0.85);
            console.log('Dynamic threshold:', dynamicThreshold);

            results = sortedVectors
                .filter(v => v.similarity >= dynamicThreshold)
                .slice(0, limit);
            
            console.log('Filtered results count:', results.length);
        }

        return results;
    } catch (error) {
        console.error('Vector search error:', error);
        throw new Error(`Vector search failed: ${error.message}`);
    }
}

    validateVector(storedVector, queryVector) {
        if (!Array.isArray(storedVector) || !Array.isArray(queryVector)) {
            return false;
        }
        if (storedVector.length !== queryVector.length) {
            return false;
        }
        if (!storedVector.every(val => typeof val === 'number' && !isNaN(val))) {
            return false;
        }
        return true;
    }

    enhancedCosineSimilarity(vecA, vecB) {
        const normalizedA = this.normalizeVector(vecA);
        const normalizedB = this.normalizeVector(vecB);
        
        const dotProduct = normalizedA.reduce((sum, a, i) => {
            const weight = Math.abs(a) > 0.5 ? 1.2 : 1;
            return sum + (a * normalizedB[i] * weight);
        }, 0);
        
        return Math.max(0, Math.min(1, (dotProduct + 1) / 2));
    }

    normalizeVector(vector) {
        const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        return magnitude === 0 ? vector : vector.map(val => val / magnitude);
    }

    async deleteVectorsByDocument(documentId) {
        try {
            const snapshot = await firestore.db.collection(this.vectorsCollection)
                .where('metadata.documentId', '==', documentId)
                .get();

            const batch = firestore.db.batch();
            snapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
            });

            await batch.commit();
        } catch (error) {
            console.error('Vector deletion error:', error);
            throw new Error('Failed to delete vectors');
        }
    }
}

export default new VectorStorageService();