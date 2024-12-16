// File: src/services/phenotypeService.js
import { promises as fs } from 'fs';
import { parse } from 'csv-parse/sync';
import { MANIFEST_PATH, GWAS_FILES_PATH } from '../config/constants.js';
import { error } from '../utils/logger.js';

// Make loadPhenotypeMapping a named export instead of private function
export async function loadPhenotypeMapping() {
    try {
        const fileContent = await fs.readFile(MANIFEST_PATH, 'utf-8');
        const lines = fileContent.split('\n');
        
        // Skip the header line
        const dataLines = lines.slice(1);
        
        const mapping = {};
        for (const line of dataLines) {
            if (line.trim()) {
                const [phecode, category, description] = line.split('\t').map(field => field.trim());
                if (phecode && category && description) {
                    mapping[phecode] = {
                        category: category,
                        description: description
                    };
                }
            }
        }
        return mapping;
    } catch (err) {
        error(`Error loading phenotype mapping: ${err.message}`);
        throw err;
    }
}

export async function getRelatedPhenotypes(currentPheno) {
    try {
        const phenoMapping = await loadPhenotypeMapping();
        const files = await fs.readdir(GWAS_FILES_PATH);
        
        const phenotypes = files
            .filter(file => file.endsWith('0.0001.gz'))
            .map(file => {
                const match = file.match(/MVP_R4\.1000G_AGR\.([^.]+)\./);
                return match ? {
                    id: match[1],
                    description: phenoMapping[match[1]] || ''
                } : null;
            })
            .filter(p => p && p.id !== currentPheno);

        return [...new Map(phenotypes.map(p => [p.id, p])).values()]
            .sort((a, b) => a.id.localeCompare(b.id));
    } catch (err) {
        error(`Error getting related phenotypes: ${err.message}`);
        throw err;
    }
}