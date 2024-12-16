# Genomics Backend API

![License](https://img.shields.io/github/license/Verma-Lab/platlas-backend)
![Node.js Version](https://img.shields.io/badge/node.js-14.x-green)
![Express Version](https://img.shields.io/badge/express-4.x-blue)
![GitHub Issues](https://img.shields.io/github/issues/Verma-Lab/platlas-backend)
![GitHub Pull Requests](https://img.shields.io/github/issues-pr/Verma-Lab/platlas-backend)

## Table of Contents

- [Introduction](#introduction)
- [Features](#features)
- [Technologies Used](#technologies-used)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Database Initialization](#database-initialization)
- [Running the Server](#running-the-server)
- [API Documentation](#api-documentation)
  - [Phenotype Endpoints](#phenotype-endpoints)
  - [GWAS Endpoints](#gwas-endpoints)
  - [PheWAS Endpoints](#phewas-endpoints)
  - [GPT Endpoints](#gpt-endpoints)
- [Repository Structure](#repository-structure)
- [Contributing](#contributing)
- [License](#license)
- [Contact](#contact)

## Introduction

The **Genomics Backend API** is designed to handle Genome-Wide Association Studies (GWAS) and Phenome-Wide Association Studies (PheWAS) data, offering powerful endpoints for querying genetic associations, managing phenotypes, and leveraging OpenAI’s GPT for enhanced analysis.

## Features

- **GWAS Data Handling**: Retrieve GWAS metadata, query data, fetch top results, and lead variants.
- **PheWAS Data Handling**: Fetch PheWAS data based on SNPs and genomic locations.
- **Phenotype Management**: Access related phenotypes and phenotype mappings.
- **OpenAI GPT Integration**: Generate SQL queries and interpret genetic data in natural language.
- **Database Initialization**: Create and manage SQLite databases with phenotype data.
- **Error Handling**: Comprehensive error logging and response management.

## Technologies Used

- **Node.js**: JavaScript runtime for server-side applications.
- **Express.js**: Web framework for building APIs.
- **SQLite3**: Lightweight relational database.
- **OpenAI GPT-3.5-turbo**: AI language model for generating insights.
- **Tabix**: Tool for querying large indexed genomic data files.
- **dotenv**: Manage environment variables.

## Prerequisites

- **Node.js**: Version 14.x or higher ([Download](https://nodejs.org/))
- **npm**: Comes with Node.js.
- **Tabix**: Installed and added to system PATH ([Tabix Installation Guide](https://github.com/samtools/tabix)).
- **Git LFS**: For managing large files ([Git LFS Guide](https://git-lfs.github.com/)).

## Installation

### 1. Clone the Repository

```bash
git clone git@github.com:Verma-Lab/platlas-backend.git
cd genomics-backend
```

### 2. Install Dependencies

```bash
npm install
```

## Configuration

### 1. Environment Variables

Create a `.env` file in the root directory and configure it as follows:

```env
PORT=5001
OPENAI_API_KEY=your_openai_api_key_here
GWAS_FILES_PATH=/path/to/gwas/files
MANIFEST_PATH=/path/to/phenotype_manifest.tsv
LEAD_MRMEGA_PATH=/path/to/lead_mrmega.csv
GWAMA_DB=/path/to/gwama.db
MRMEGA_DB=/path/to/mrmega.db
```

**Note**: Replace `/path/to/...` with actual paths.


## Database Initialization

### Initialize via API Endpoint

Start the server and call the `/api/init-database` endpoint:

```bash
curl -X POST http://localhost:5001/api/init-database
```

### Manual Initialization

Run the database initialization script:

```bash
node src/services/gptService.js
```

## Running the Server

Start the server with:

```bash
npm start
```

Access the API at `http://localhost:5001/api`.

## API Documentation

### Phenotype Endpoints

1. **Get Related Phenotypes**
   - **GET** `/api/getRelatedPhenotypes`
   - Query: `phenoId` (required)

2. **Get Phenotype Mapping**
   - **GET** `/api/getPhenotypeMapping`

### GWAS Endpoints

1. **Get GWAS Metadata**
   - **GET** `/api/getGWASMetadata`


2. **Query GWAS Data**
   - **GET** `/api/queryGWASData`
   - Query: `phenoId`, `cohortId`, `study` (all required)
  

### GPT Endpoints

1. **Ask GPT**
   - **GET** `/api/askgpt`
   - Query: `question` (required)
 

2. **Initialize Database**
   - **POST** `/api/init-database`
 

## Repository Structure

```
genomics-backend/
├── src/
│   ├── controllers/
│   ├── services/
│   ├── routes/
│   ├── utils/
│   ├── config/
│   └── index.js
├── .gitignore
├── package.json
├── README.md
```

## Contributing

1. Fork the repository.
2. Create a branch: `git checkout -b feature/YourFeature`.
3. Commit your changes: `git commit -m 'Add feature'`.
4. Push the branch: `git push origin feature/YourFeature`.
5. Open a pull request.

## License

This project is licensed under the [MIT License](LICENSE).

## Contact

- **GitHub**: [Verma-Lab](https://github.com/Verma-Lab)
- **Email**: guptahr@upenn.pennmedicine.edu

