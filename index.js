#!/usr/bin/env node

require('dotenv').config();

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const _ = require('lodash');

// Configuration using environment variables
const config = {
  environments: {
    dev: {
      baseUrl: process.env.DEV_BASE_URL,
      bearerToken: process.env.DEV_BEARER_TOKEN
    },
    tst: {
      baseUrl: process.env.TST_BASE_URL,
      bearerToken: process.env.TST_BEARER_TOKEN
    },
    prod: {
      baseUrl: process.env.PROD_BASE_URL,
      bearerToken: process.env.PROD_BEARER_TOKEN
    }
  },
  endpoints: {
    login: '/ccadmin/v1/login',
    profiles: '/ccadmin/v1/profiles',
    products: '/ccadmin/v1/products'
  },
  limits: {
    profilesPerRequest: parseInt(process.env.PROFILES_LIMIT) || 250
  }
};

class ProfileFetcher {
  constructor(environment) {
    this.validateEnvironment(environment);

    this.environment = environment;
    this.config = config.environments[environment];
    this.accessToken = null;
    this.tokenExpiresAt = null;
    this.responsesDir = path.join(__dirname, 'responses');
    this.resultDir = path.join(__dirname, 'outputs');

    this.ensureResponsesDirectory();
    this.ensureResultDirectory();
  }

  validateEnvironment(environment) {
    if (!config.environments[environment]) {
      throw new Error(
        chalk.red(`❌ Environment '${environment}' not found.\n`) +
        chalk.yellow(`Available environments: ${Object.keys(config.environments).join(', ')}`)
      );
    }

    const envConfig = config.environments[environment];
    if (!envConfig.baseUrl || !envConfig.bearerToken) {
      throw new Error(
        chalk.red(`❌ Missing configuration for environment '${environment}'.\n`) +
        chalk.yellow(`Please check your .env file and ensure ${environment.toUpperCase()}_BASE_URL and ${environment.toUpperCase()}_BEARER_TOKEN are set.`)
      );
    }
  }

  ensureResponsesDirectory() {
    if (!fs.existsSync(this.responsesDir)) {
      fs.mkdirSync(this.responsesDir, { recursive: true });
    }
  }

  ensureResultDirectory() {
    if (!fs.existsSync(this.resultDir)) {
      fs.mkdirSync(this.resultDir, { recursive: true });
    }
  }

  buildFieldsParam(fields) {
    if (!fields || fields.trim() === '') {
      return '';
    }
    
    const fieldsList = fields.split(',').map(field => field.trim());
    const itemsFields = fieldsList.map(field => `items.${field}`);
    return itemsFields.join(',');
  }

  buildQueryParam(queryField, queryValue) {
    return `${queryField} co "${queryValue}"`;
  }

  async consolidateResults(baseName, totalProfiles, consolidate = false, paOnly = false) {
    if (!consolidate) return;

    const spinner = ora(chalk.blue('🔄 Consolidating results...')).start();

    try {
      // Find all files from this execution
      const executionFiles = fs.readdirSync(this.responsesDir)
        .filter(file => file.startsWith(baseName) && file.endsWith('.json'))
        .sort((a, b) => {
          const aNum = parseInt(a.match(/_(\d+)\.json$/)[1]);
          const bNum = parseInt(b.match(/_(\d+)\.json$/)[1]);
          return aNum - bNum;
        });

      if (executionFiles.length === 0) {
        spinner.fail(chalk.red('No files found to consolidate'));
        return;
      }

      // Consolidate all items
      let allItems = [];
      const filesToDelete = [];

      for (const filename of executionFiles) {
        const filepath = path.join(this.responsesDir, filename);
        const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));

        allItems.push(...data.items);
        filesToDelete.push(filepath);
      }

      // Filter PA-only products if requested
      if (paOnly) {
        const originalCount = allItems.length;
        allItems = allItems.filter(item => {
          const id = item.id || item.repositoryId || item.productId || item.Id;
          return id && id.startsWith('PA');
        });
        const filteredCount = originalCount - allItems.length;
        if (filteredCount > 0) {
          console.log(chalk.gray(`  Filtered out ${filteredCount} non-PA products from consolidated results`));
        }
      }

      // Create consolidated result
      const consolidatedResult = {
        total: allItems.length,
        env: this.environment,
        items: allItems
      };

      // Save consolidated file with unique name
      const outputFilename = this.generateUniqueFilename(this.resultDir, `${baseName}_consolidated`, 'json');
      const outputFilepath = path.join(this.resultDir, outputFilename);

      fs.writeFileSync(outputFilepath, JSON.stringify(consolidatedResult, null, 2));

      // Delete original files
      filesToDelete.forEach(filepath => {
        fs.unlinkSync(filepath);
      });

      spinner.succeed(chalk.green('Results consolidated successfully!'));
      console.log(chalk.cyan(`📄 Consolidated file: ${outputFilename}`));
      console.log(chalk.cyan(`🗂️  Total items: ${chalk.bold(allItems.length)}`));
      console.log(chalk.cyan(`🗑️  Deleted ${chalk.bold(filesToDelete.length)} original files\n`));

      // Generate CSV file
      await this.generateCSV(consolidatedResult, outputFilename);

      // Return info about created files
      const csvFilename = outputFilename.replace('.json', '.csv');
      return [outputFilename, csvFilename];

    } catch (error) {
      spinner.fail(chalk.red('❌ Error consolidating results:'));
      console.error(error.message);
      throw error;
    }
  }

  async generateCSV(consolidatedResult, jsonFilename) {
    const spinner = ora(chalk.blue('📊 Generating CSV file...')).start();
    
    try {
      const items = consolidatedResult.items;
      
      if (items.length === 0) {
        spinner.warn(chalk.yellow('No items to export to CSV'));
        return;
      }

      // Get all unique fields from all items
      const allFields = new Set();
      items.forEach(item => {
        Object.keys(item).forEach(key => allFields.add(key));
      });
      
      const fields = Array.from(allFields).sort();
      
      // Create CSV header
      let csvContent = fields.join(',') + '\n';
      
      // Add data rows
      items.forEach(item => {
        const row = fields.map(field => {
          let value = item[field];
          
          // Handle different data types
          if (value === null || value === undefined) {
            return '';
          }
          
          // Convert objects/arrays to JSON string
          if (typeof value === 'object') {
            value = JSON.stringify(value);
          }
          
          // Escape quotes and wrap in quotes if contains comma or quotes
          value = String(value);
          if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            value = '"' + value.replace(/"/g, '""') + '"';
          }
          
          return value;
        });
        
        csvContent += row.join(',') + '\n';
      });
      
      // Create CSV filename based on JSON filename
      const csvFilename = jsonFilename.replace('.json', '.csv');
      const csvFilepath = path.join(this.resultDir, csvFilename);
      
      fs.writeFileSync(csvFilepath, csvContent, 'utf8');
      
      spinner.succeed(chalk.green('CSV file generated successfully!'));
      console.log(chalk.cyan(`📊 CSV file: ${csvFilename}`));
      console.log(chalk.cyan(`📋 Columns: ${chalk.bold(fields.length)} (${fields.join(', ')})\n`));
      
    } catch (error) {
      spinner.fail(chalk.red('❌ Error generating CSV:'));
      console.error(error.message);
      throw error;
    }
  }

  async mineData(inputFile, field, condition) {
    const spinner = ora(chalk.blue('⛏️  Mining data...')).start();
    
    try {
      // Check if input file exists
      const inputPath = path.join(this.resultDir, inputFile);
      if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file not found: ${inputFile}`);
      }

      // Load consolidated data
      const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
      const items = data.items || [];

      if (items.length === 0) {
        spinner.warn(chalk.yellow('No items found in input file'));
        return;
      }

      // Check if field exists in data
      const hasField = items.some(item => item.hasOwnProperty(field));
      if (!hasField) {
        throw new Error(`Field '${field}' not found in any items. Available fields: ${Object.keys(items[0]).join(', ')}`);
      }

      // Analyze field type
      const fieldAnalysis = this.analyzeFieldType(items, field);
      spinner.text = chalk.blue(`⛏️  Mining data... (Field: ${field}, Type: ${fieldAnalysis.type})`);

      // Validate condition against field type
      this.validateCondition(field, condition, fieldAnalysis);

      // Parse condition and filter data
      const filteredItems = this.filterItems(items, field, condition, fieldAnalysis);

      if (filteredItems.length === 0) {
        spinner.warn(chalk.yellow(`No items match the condition: ${field} ${condition}`));
        return;
      }

      // Create result object
      const result = {
        source: inputFile,
        filter: `${field} ${condition}`,
        fieldAnalysis: {
          fieldName: field,
          detectedType: fieldAnalysis.type,
          details: fieldAnalysis.details,
          examples: fieldAnalysis.examples
        },
        originalCount: items.length,
        filteredCount: filteredItems.length,
        items: filteredItems
      };

      // Generate unique output filename
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      const outputFilename = this.generateUniqueFilename(this.resultDir, `profiles_datamined_${timestamp}`, 'json');
      const outputPath = path.join(this.resultDir, outputFilename);

      // Save filtered data
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

      // Generate CSV for mined data
      await this.generateMinedCSV(result, outputFilename);

      spinner.succeed(chalk.green('Data mining completed successfully!'));
      console.log(chalk.cyan(`📊 Original items: ${chalk.bold(items.length)}`));
      console.log(chalk.cyan(`🎯 Filtered items: ${chalk.bold(filteredItems.length)}`));
      console.log(chalk.cyan(`📄 JSON output: ${outputFilename}`));
      console.log(chalk.cyan(`📊 CSV output: ${outputFilename.replace('.json', '.csv')}\n`));

    } catch (error) {
      spinner.fail(chalk.red('❌ Error mining data:'));
      console.error(error.message);
      throw error;
    }
  }

  analyzeFieldType(items, field) {
    const samples = items
      .map(item => item[field])
      .filter(value => value !== null && value !== undefined)
      .slice(0, 100); // Analyze first 100 non-null values

    if (samples.length === 0) {
      return { type: 'null', details: 'All values are null/undefined' };
    }

    const analysis = {
      booleanCount: 0,
      numberCount: 0,
      stringCount: 0,
      dateCount: 0,
      total: samples.length,
      examples: samples.slice(0, 3)
    };

    samples.forEach(value => {
      const strValue = String(value).toLowerCase();
      
      // Check boolean
      if (strValue === 'true' || strValue === 'false' || typeof value === 'boolean') {
        analysis.booleanCount++;
      }
      // Check number
      else if (!isNaN(value) && !isNaN(parseFloat(value))) {
        analysis.numberCount++;
      }
      // Check date
      else if (typeof value === 'string' && this.isDateString(value)) {
        analysis.dateCount++;
      }
      // String
      else {
        analysis.stringCount++;
      }
    });

    // Determine primary type (>70% threshold)
    const threshold = analysis.total * 0.7;
    
    if (analysis.booleanCount >= threshold) {
      return { type: 'boolean', details: `${analysis.booleanCount}/${analysis.total} boolean values`, examples: analysis.examples };
    }
    if (analysis.numberCount >= threshold) {
      return { type: 'number', details: `${analysis.numberCount}/${analysis.total} numeric values`, examples: analysis.examples };
    }
    if (analysis.dateCount >= threshold) {
      return { type: 'date', details: `${analysis.dateCount}/${analysis.total} date values`, examples: analysis.examples };
    }
    
    return { type: 'string', details: `${analysis.stringCount}/${analysis.total} string values`, examples: analysis.examples };
  }

  isDateString(value) {
    // Common date patterns
    const datePatterns = [
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, // ISO 8601
      /^\d{4}-\d{2}-\d{2}/, // YYYY-MM-DD
      /^\d{2}\/\d{2}\/\d{4}/, // MM/DD/YYYY
      /^\d{2}-\d{2}-\d{4}/, // DD-MM-YYYY
    ];

    if (typeof value !== 'string') return false;
    
    return datePatterns.some(pattern => pattern.test(value)) && !isNaN(Date.parse(value));
  }

  validateCondition(field, condition, fieldAnalysis) {
    const { type } = fieldAnalysis;

    console.log(chalk.gray(`📊 Field Analysis: ${field} is ${chalk.bold(type)} (${fieldAnalysis.details})`));
    console.log(chalk.gray(`🔍 Examples: ${fieldAnalysis.examples.join(', ')}`));

    // Validate condition format based on field type
    switch (type) {
      case 'boolean':
        if (!['true', 'false'].includes(condition.toLowerCase())) {
          console.log(chalk.yellow(`⚠️  Warning: Expected boolean value (true/false), got: ${condition}`));
        }
        break;
        
      case 'number':
        const numericMatch = condition.match(/^([><=]+)?\s*(-?\d+\.?\d*)$/);
        if (!numericMatch) {
          console.log(chalk.yellow(`⚠️  Warning: Expected numeric condition (e.g., >100, <=50), got: ${condition}`));
        }
        break;
        
      case 'date':
        if (condition.includes(' ') && condition.split(' ').length === 2) {
          const [start, end] = condition.split(' ');
          if (isNaN(Date.parse(start)) || isNaN(Date.parse(end))) {
            console.log(chalk.yellow(`⚠️  Warning: Expected date range (e.g., "2020-01-01 2023-12-31"), got: ${condition}`));
          }
        } else if (isNaN(Date.parse(condition))) {
          console.log(chalk.yellow(`⚠️  Warning: Expected date value or range, got: ${condition}`));
        }
        break;
        
      case 'string':
        // No specific validation for strings
        break;
    }
  }

  filterItems(items, field, condition, fieldAnalysis = null) {
    const fieldType = fieldAnalysis?.type || 'string';

    return items.filter(item => {
      const value = item[field];
      
      // Handle null/undefined values
      if (value === null || value === undefined) {
        return condition.toLowerCase() === 'null' || condition.toLowerCase() === 'undefined';
      }

      // Type-specific filtering with optimization
      switch (fieldType) {
        case 'boolean':
          return this.filterBoolean(value, condition);
        
        case 'number':
          return this.filterNumber(value, condition);
        
        case 'date':
          return this.filterDate(value, condition);
        
        case 'string':
        default:
          return this.filterString(value, condition);
      }
    });
  }

  filterBoolean(value, condition) {
    const boolCondition = condition.toLowerCase();
    const boolValue = String(value).toLowerCase();
    
    if (boolCondition === 'true' || boolCondition === 'false') {
      return boolValue === boolCondition;
    }
    
    // Fallback to string contains for non-boolean conditions
    return this.filterString(value, condition);
  }

  filterNumber(value, condition) {
    // Try numeric comparison first
    const numericMatch = condition.match(/^([><=]+)?\s*(-?\d+\.?\d*)$/);
    if (numericMatch) {
      const operator = numericMatch[1] || '=';
      const conditionValue = parseFloat(numericMatch[2]);
      const itemValue = parseFloat(value);
      
      if (!isNaN(itemValue) && !isNaN(conditionValue)) {
        switch (operator) {
          case '>': return itemValue > conditionValue;
          case '<': return itemValue < conditionValue;
          case '>=': return itemValue >= conditionValue;
          case '<=': return itemValue <= conditionValue;
          case '=': 
          default: return itemValue === conditionValue;
        }
      }
    }
    
    // Fallback to string contains
    return this.filterString(value, condition);
  }

  filterDate(value, condition) {
    // Date range conditions (format: "startDate endDate")
    if (condition.includes(' ') && condition.split(' ').length === 2) {
      const [startDate, endDate] = condition.split(' ');
      const itemDate = new Date(value);
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      if (!isNaN(itemDate) && !isNaN(start) && !isNaN(end)) {
        return itemDate >= start && itemDate <= end;
      }
    }
    
    // Single date comparison
    const conditionDate = new Date(condition);
    if (!isNaN(conditionDate)) {
      const itemDate = new Date(value);
      if (!isNaN(itemDate)) {
        // Same day comparison (ignoring time)
        return itemDate.toDateString() === conditionDate.toDateString();
      }
    }
    
    // Fallback to string contains
    return this.filterString(value, condition);
  }

  filterString(value, condition) {
    return String(value).toLowerCase().includes(condition.toLowerCase());
  }

  async generateMinedCSV(result, jsonFilename) {
    try {
      const items = result.items;
      
      if (items.length === 0) {
        return;
      }

      // Get all unique fields from all items
      const allFields = new Set();
      items.forEach(item => {
        Object.keys(item).forEach(key => allFields.add(key));
      });
      
      const fields = Array.from(allFields).sort();
      
      // Create CSV header
      let csvContent = fields.join(',') + '\n';
      
      // Add data rows
      items.forEach(item => {
        const row = fields.map(field => {
          let value = item[field];
          
          if (value === null || value === undefined) {
            return '';
          }
          
          if (typeof value === 'object') {
            value = JSON.stringify(value);
          }
          
          value = String(value);
          if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            value = '"' + value.replace(/"/g, '""') + '"';
          }
          
          return value;
        });
        
        csvContent += row.join(',') + '\n';
      });
      
      // Create CSV filename based on JSON filename
      const csvFilename = jsonFilename.replace('.json', '.csv');
      const csvFilepath = path.join(this.resultDir, csvFilename);
      
      fs.writeFileSync(csvFilepath, csvContent, 'utf8');
      
    } catch (error) {
      console.error(chalk.red('Error generating mined CSV:'), error.message);
    }
  }

  displayCreatedFilesSummary(createdFiles, consolidate) {
    console.log(chalk.blue.bold('\n📂 Files Created:'));
    
    if (consolidate && createdFiles.consolidatedFiles.length > 0) {
      console.log(chalk.green('📊 Consolidated Results:'));
      createdFiles.consolidatedFiles.forEach(filename => {
        const isCSV = filename.endsWith('.csv');
        const icon = isCSV ? '📋' : '📄';
        const location = 'outputs/';
        console.log(chalk.cyan(`  ${icon} ${location}${filename}`));
      });
    } else if (createdFiles.responseFiles.length > 0) {
      console.log(chalk.green('📁 Response Files:'));
      createdFiles.responseFiles.forEach(filename => {
        const location = 'responses/';
        console.log(chalk.cyan(`  📄 ${location}${filename}`));
      });
    }
    
    const totalFiles = createdFiles.responseFiles.length + createdFiles.consolidatedFiles.length;
    console.log(chalk.gray(`\n📈 Total files: ${chalk.bold(totalFiles)}`));
  }

  isTokenExpired() {
    if (!this.tokenExpiresAt) return true;
    // Check if token expires in the next 30 seconds (buffer time)
    return Date.now() >= (this.tokenExpiresAt - 30000);
  }

  async authenticate() {
    const spinner = ora(chalk.blue(`Authenticating in ${chalk.bold(this.environment)} environment...`)).start();
    
    try {
      const response = await axios.post(
        `${this.config.baseUrl}${config.endpoints.login}`,
        'grant_type=client_credentials',
        {
          headers: {
            'Authorization': `Bearer ${this.config.bearerToken}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      this.accessToken = response.data.access_token;
      // Set expiration time (response.expires_in is in seconds)
      this.tokenExpiresAt = Date.now() + (response.data.expires_in * 1000);
      
      spinner.succeed(chalk.green(`Authentication successful!`));
      console.log(chalk.yellow(`⏰ Token expires in ${response.data.expires_in} seconds\n`));
      
      return this.accessToken;
    } catch (error) {
      spinner.fail(chalk.red('Authentication failed'));
      console.error(chalk.red('Details:'), error.response?.data || error.message);
      throw error;
    }
  }

  async ensureValidToken() {
    if (!this.accessToken || this.isTokenExpired()) {
      console.log(chalk.yellow('🔄 Token expired or missing, refreshing...'));
      await this.authenticate();
    }
  }

  generateUniqueFilename(directory, basePattern, extension) {
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    
    const baseFilename = `${basePattern}.${extension}`;
    const basePath = path.join(directory, baseFilename);
    
    // If base filename doesn't exist, use it
    if (!fs.existsSync(basePath)) {
      return baseFilename;
    }
    
    // Find the highest number in parentheses
    let maxNumber = 0;
    const files = fs.readdirSync(directory);
    
    files.forEach(file => {
      const regex = new RegExp(`^${basePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\((\\d+)\\))?\\.${extension}$`);
      const match = file.match(regex);
      if (match) {
        const number = match[2] ? parseInt(match[2]) : 0;
        maxNumber = Math.max(maxNumber, number);
      }
    });
    
    const nextNumber = maxNumber + 1;
    return `${basePattern}(${nextNumber}).${extension}`;
  }

  generateUniqueBaseName(prefix = 'profile') {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const dateStr = `${day}-${month}-${year}`;
    
    // Check for existing files with the same date
    const basePattern = `${prefix}_${dateStr}`;
    const existingFiles = fs.readdirSync(this.responsesDir)
      .filter(file => file.startsWith(basePattern) && file.endsWith('.json'));
    
    if (existingFiles.length === 0) {
      return `${prefix}_${dateStr}`;
    }
    
    // Find the highest execution number for today
    let maxExecNumber = 0;
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filenameRegex = new RegExp(`^${escapedPrefix}_\\d{2}-\\d{2}-\\d{4}(\\((\\d+)\\))?_\\d+\\.json$`);
    existingFiles.forEach(file => {
      const match = file.match(filenameRegex);
      if (match) {
        const execNumber = match[2] ? parseInt(match[2]) : 0;
        maxExecNumber = Math.max(maxExecNumber, execNumber);
      }
    });
    
    const nextExecNumber = maxExecNumber + 1;
    return `${prefix}_${dateStr}(${nextExecNumber})`;
  }

  async searchProfiles(queryField, queryValue, fields = '', consolidate = false) {
    await this.ensureValidToken();

    console.log(chalk.cyan(`🔍 Searching profiles where ${chalk.bold(queryField)} contains "${chalk.bold(queryValue)}"...`));
    if (fields) {
      console.log(chalk.gray(`📋 Selected fields: ${fields}\n`));
    }
    
    try {
      let offset = 0;
      let totalProfiles = 0;
      let fetchedProfiles = 0;
      let requestCount = 0;
      
      // Generate unique base name for this execution
      const baseName = this.generateUniqueBaseName('profile');

      while (true) {
        // Ensure token is valid before each request
        await this.ensureValidToken();
        
        requestCount++;
        
        const spinner = ora(chalk.blue(`Making request ${requestCount} (offset: ${offset})...`)).start();
        
        const queryParam = this.buildQueryParam(queryField, queryValue);
        const fieldsParam = this.buildFieldsParam(fields);
        const url = `${this.config.baseUrl}${config.endpoints.profiles}`;
        
        const params = {
          q: queryParam,
          offset: offset,
          limit: config.limits.profilesPerRequest
        };

        if (fieldsParam) {
          params.fields = fieldsParam;
        }
        
        const response = await axios.get(url, {
          params,
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        });

        const data = response.data;
        
        // Na primeira requisição, capturar o total
        if (requestCount === 1) {
          totalProfiles = data.total;
          spinner.succeed(chalk.green(`Request ${requestCount} completed`));
          console.log(chalk.magenta(`📊 Total profiles found: ${chalk.bold(totalProfiles)}`));
        } else {
          spinner.succeed(chalk.green(`Request ${requestCount} completed`));
        }

        // Salvar resposta em arquivo
        const filename = `${baseName}_${requestCount}.json`;
        const filepath = path.join(this.responsesDir, filename);
        
        fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
        console.log(chalk.gray(`💾 Response saved to: ${filename}`));
        console.log(chalk.gray(`📄 Profiles in this response: ${data.items.length}\n`));
        
        fetchedProfiles += data.items.length;
        
        // Verificar se ainda há mais profiles para buscar
        if (fetchedProfiles >= totalProfiles || data.items.length < config.limits.profilesPerRequest) {
          console.log(chalk.green.bold(`✅ Search completed!`));
          console.log(chalk.cyan(`📈 Total profiles fetched: ${chalk.bold(fetchedProfiles)}/${chalk.bold(totalProfiles)}`));
          console.log(chalk.cyan(`📁 Total files generated: ${chalk.bold(requestCount)}`));
          
          // Collect created files info
          const createdFiles = {
            responseFiles: [],
            consolidatedFiles: []
          };
          
          // Add response files (if not consolidated, they remain)
          if (!consolidate) {
            for (let i = 1; i <= requestCount; i++) {
              createdFiles.responseFiles.push(`${baseName}_${i}.json`);
            }
          }
          
          // Consolidate results if requested and collect consolidated files
          if (consolidate) {
            const consolidatedInfo = await this.consolidateResults(baseName, totalProfiles, consolidate, false);
            if (consolidatedInfo) {
              createdFiles.consolidatedFiles = consolidatedInfo;
            }
          }
          
          // Display created files summary
          this.displayCreatedFilesSummary(createdFiles, consolidate);
          
          break;
        }
        
        offset += config.limits.profilesPerRequest;
        
        // Pequena pausa entre requests para não sobrecarregar o servidor
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
    } catch (error) {
      console.error(chalk.red('❌ Error searching profiles:'), error.response?.data || error.message);
      throw error;
    }
  }

  async generateProductIdList(consolidatedResult, jsonFilename, paOnly = false) {
    const spinner = ora(chalk.blue('📋 Generating product ID list CSV...')).start();

    try {
      const items = consolidatedResult.items;

      if (items.length === 0) {
        spinner.warn(chalk.yellow('No items to export to ID list'));
        return;
      }

      // Extract IDs - try common ID field names
      let ids = items.map(item => {
        return item.id || item.repositoryId || item.productId || item.Id;
      }).filter(id => id); // Remove undefined/null values

      // Filter only IDs starting with "PA" if flag is set
      if (paOnly) {
        const originalCount = ids.length;
        ids = ids.filter(id => id.startsWith('PA'));
        const filteredCount = originalCount - ids.length;
        if (filteredCount > 0) {
          console.log(chalk.gray(`  Filtered out ${filteredCount} non-PA IDs`));
        }
      }

      if (ids.length === 0) {
        spinner.warn(chalk.yellow('No valid IDs found after filtering'));
        return;
      }

      // Create CSV content - just IDs, one per line, no header
      const csvContent = ids.join('\n');

      // Create filename
      const idListFilename = jsonFilename.replace('.json', '_ids.csv');
      const csvFilepath = path.join(this.resultDir, idListFilename);

      fs.writeFileSync(csvFilepath, csvContent, 'utf8');

      spinner.succeed(chalk.green('Product ID list generated successfully!'));
      console.log(chalk.cyan(`📋 ID List file: ${idListFilename}`));
      console.log(chalk.cyan(`🔢 Total IDs: ${chalk.bold(ids.length)}\n`));

      return idListFilename;

    } catch (error) {
      spinner.fail(chalk.red('❌ Error generating ID list:'));
      console.error(error.message);
      throw error;
    }
  }

  async searchProducts(query, fields = '', consolidate = false, generateIdList = false, paOnly = false) {
    await this.ensureValidToken();

    console.log(chalk.cyan(`🔍 Searching products with query "${chalk.bold(query)}"...`));
    if (fields) {
      console.log(chalk.gray(`📋 Selected fields: ${fields}\n`));
    }

    try {
      let offset = 0;
      let totalProducts = 0;
      let fetchedProducts = 0;
      let requestCount = 0;

      const baseName = this.generateUniqueBaseName('products');

      while (true) {
        await this.ensureValidToken();

        requestCount++;

        const spinner = ora(chalk.blue(`Making request ${requestCount} (offset: ${offset})...`)).start();

        const fieldsParam = this.buildFieldsParam(fields);
        const url = `${this.config.baseUrl}${config.endpoints.products}`;

        const params = {
          q: query,
          offset: offset,
          limit: config.limits.profilesPerRequest
        };

        if (fieldsParam) {
          params.fields = fieldsParam;
        }

        const response = await axios.get(url, {
          params,
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        });

        const data = response.data;

        if (requestCount === 1) {
          totalProducts = data.totalResults;
          spinner.succeed(chalk.green(`Request ${requestCount} completed`));
          console.log(chalk.magenta(`📊 Total products found: ${chalk.bold(totalProducts)}`));
        } else {
          spinner.succeed(chalk.green(`Request ${requestCount} completed`));
        }

        const filename = `${baseName}_${requestCount}.json`;
        const filepath = path.join(this.responsesDir, filename);

        fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
        console.log(chalk.gray(`💾 Response saved to: ${filename}`));
        console.log(chalk.gray(`📄 Products in this response: ${data.items.length}\n`));

        fetchedProducts += data.items.length;

        if (fetchedProducts >= totalProducts || data.items.length < config.limits.profilesPerRequest) {
          console.log(chalk.green.bold(`✅ Search completed!`));
          console.log(chalk.cyan(`📈 Total products fetched: ${chalk.bold(fetchedProducts)}/${chalk.bold(totalProducts)}`));
          console.log(chalk.cyan(`📁 Total files generated: ${chalk.bold(requestCount)}`));

          const createdFiles = {
            responseFiles: [],
            consolidatedFiles: []
          };

          if (!consolidate && !generateIdList) {
            for (let i = 1; i <= requestCount; i++) {
              createdFiles.responseFiles.push(`${baseName}_${i}.json`);
            }
          }

          if (consolidate || generateIdList) {
            const consolidatedInfo = await this.consolidateResults(baseName, totalProducts, true, paOnly);
            if (consolidatedInfo) {
              createdFiles.consolidatedFiles = consolidatedInfo;

              // Generate ID list if requested
              if (generateIdList) {
                const consolidatedFilePath = path.join(this.resultDir, consolidatedInfo[0]);
                const consolidatedData = JSON.parse(fs.readFileSync(consolidatedFilePath, 'utf8'));
                const idListFile = await this.generateProductIdList(consolidatedData, consolidatedInfo[0], paOnly);
                if (idListFile) {
                  createdFiles.consolidatedFiles.push(idListFile);
                }
              }
            }
          }

          this.displayCreatedFilesSummary(createdFiles, consolidate || generateIdList);

          break;
        }

        offset += config.limits.profilesPerRequest;

        await new Promise(resolve => setTimeout(resolve, 100));
      }

    } catch (error) {
      console.error(chalk.red('❌ Error searching products:'), error.response?.data || error.message);
      throw error;
    }
  }

  ensureProcessedDirectory() {
    const processedDir = path.join(__dirname, 'processed');
    if (!fs.existsSync(processedDir)) {
      fs.mkdirSync(processedDir, { recursive: true });
    }
    return processedDir;
  }

  async deleteProducts(csvFile = null, concurrency = 1) {
    await this.ensureValidToken();

    try {
      const assetsDir = path.join(__dirname, 'inputs');
      let csvPath;
      let actualFileName;

      // Se não foi fornecido um arquivo específico, procurar por arquivo começando com "products"
      if (!csvFile) {
        const files = fs.readdirSync(assetsDir);
        const productFiles = files.filter(file =>
          file.toLowerCase().startsWith('products') &&
          (file.endsWith('.csv') || file.endsWith('.txt'))
        );

        if (productFiles.length === 0) {
          throw new Error('No file starting with "products" found in inputs/ folder');
        }

        if (productFiles.length > 1) {
          console.log(chalk.yellow(`⚠️  Multiple product files found:`));
          productFiles.forEach((file, index) => {
            console.log(chalk.gray(`  ${index + 1}. ${file}`));
          });
          console.log(chalk.cyan(`Using: ${chalk.bold(productFiles[0])}\n`));
        }

        actualFileName = productFiles[0];
        csvPath = path.join(assetsDir, actualFileName);
      } else {
        actualFileName = csvFile;
        csvPath = path.join(assetsDir, csvFile);

        if (!fs.existsSync(csvPath)) {
          throw new Error(`CSV file not found: ${csvPath}`);
        }
      }

      console.log(chalk.cyan(`🗑️  Starting product deletion from ${chalk.bold(actualFileName)}...`));
      console.log(chalk.gray(`⚡ Concurrency level: ${chalk.bold(concurrency)} parallel request(s)\n`));

      const csvContent = fs.readFileSync(csvPath, 'utf8');
      const productIds = csvContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      console.log(chalk.magenta(`📊 Total products to delete: ${chalk.bold(productIds.length)}\n`));

      // Relatório de resultados
      const report = {
        total: productIds.length,
        deleted: 0,
        failed: 0,
        skipped: 0,
        invalidIds: [],
        errors: [],
        startTime: new Date().toISOString(),
        environment: this.environment,
        concurrency: concurrency
      };

      // Processar produtos com concorrência controlada
      let processedCount = 0;
      const activeSpinners = new Map();

      const deleteProduct = async (productId, index) => {
        // Validar se o ID começa com "PA"
        if (!productId.startsWith('PA')) {
          report.skipped++;
          report.invalidIds.push(productId);
          console.log(chalk.gray(`[${index + 1}/${productIds.length}] Skipping ${chalk.bold(productId)} - Invalid ID (must start with "PA")`));
          return;
        }

        await this.ensureValidToken();

        const spinner = ora(
          chalk.blue(`[${index + 1}/${productIds.length}] Deleting product ${chalk.bold(productId)}...`)
        ).start();

        activeSpinners.set(productId, spinner);

        try {
          const url = `${this.config.baseUrl}${config.endpoints.products}/${productId}`;

          await axios.delete(url, {
            headers: {
              'Authorization': `Bearer ${this.accessToken}`,
              'Content-Type': 'application/json'
            }
          });

          report.deleted++;
          spinner.succeed(chalk.green(`[${index + 1}/${productIds.length}] Product ${chalk.bold(productId)} deleted successfully`));

        } catch (error) {
          report.failed++;
          const errorMsg = error.response?.data?.message || error.message;
          const errorDetail = {
            productId,
            error: errorMsg,
            statusCode: error.response?.status
          };
          report.errors.push(errorDetail);

          if (error.response?.status === 404) {
            spinner.warn(chalk.yellow(`[${index + 1}/${productIds.length}] Product ${chalk.bold(productId)} not found (404)`));
          } else {
            spinner.fail(chalk.red(`[${index + 1}/${productIds.length}] Failed to delete ${chalk.bold(productId)}: ${errorMsg}`));
          }
        } finally {
          activeSpinners.delete(productId);
        }
      };

      // Processar em lotes com concorrência controlada
      for (let i = 0; i < productIds.length; i += concurrency) {
        const batch = productIds.slice(i, i + concurrency);
        const batchPromises = batch.map((productId, batchIndex) =>
          deleteProduct(productId, i + batchIndex)
        );

        await Promise.all(batchPromises);
        processedCount += batch.length;
      }

      report.endTime = new Date().toISOString();

      // Salvar relatório
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      const reportFilename = this.generateUniqueFilename(this.resultDir, `delete_report_${timestamp}`, 'json');
      const reportPath = path.join(this.resultDir, reportFilename);

      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

      // Exibir resumo final
      console.log(chalk.blue.bold('\n' + '='.repeat(60)));
      console.log(chalk.blue.bold('📊 DELETION REPORT'));
      console.log(chalk.blue.bold('='.repeat(60)));
      console.log(chalk.cyan(`🎯 Total products: ${chalk.bold(report.total)}`));
      console.log(chalk.green(`✅ Successfully deleted: ${chalk.bold(report.deleted)}`));
      console.log(chalk.red(`❌ Failed: ${chalk.bold(report.failed)}`));
      console.log(chalk.gray(`⏭️  Skipped (Invalid ID): ${chalk.bold(report.skipped)}`));
      console.log(chalk.gray(`📁 Report saved to: ${reportFilename}`));
      console.log(chalk.blue.bold('='.repeat(60) + '\n'));

      if (report.skipped > 0) {
        console.log(chalk.yellow.bold('⚠️  Invalid Product IDs (must start with "PA"):'));
        report.invalidIds.forEach((id, index) => {
          console.log(chalk.yellow(`  ${index + 1}. ${id}`));
        });
        console.log('');
      }

      if (report.failed > 0) {
        console.log(chalk.red.bold('❌ Errors encountered:'));
        report.errors.forEach((err, index) => {
          console.log(chalk.red(`  ${index + 1}. ${err.productId}: ${err.error} (Status: ${err.statusCode})`));
        });
        console.log('');
      }

      // Mover arquivo CSV para pasta processed
      const moveSpinner = ora(chalk.blue('Moving CSV file to processed folder...')).start();
      try {
        const processedDir = this.ensureProcessedDirectory();
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
        const processedFileName = `${path.basename(actualFileName, path.extname(actualFileName))}_${timestamp}${path.extname(actualFileName)}`;
        const processedPath = path.join(processedDir, processedFileName);

        // Mover arquivo
        fs.renameSync(csvPath, processedPath);

        moveSpinner.succeed(chalk.green(`CSV file moved to: processed/${processedFileName}`));
      } catch (moveError) {
        moveSpinner.fail(chalk.red('Failed to move CSV file'));
        console.error(chalk.gray(`  Error: ${moveError.message}`));
      }

      return report;

    } catch (error) {
      console.error(chalk.red('❌ Error deleting products:'), error.message);
      throw error;
    }
  }
}

// Configurar CLI
const program = new Command();

program
  .name('profile-fetcher')
  .description(chalk.blue.bold('🚀 Fetch profiles from Oracle Commerce Cloud'))
  .version('1.0.0');

program
  .command('searchProfiles')
  .description('Search profiles with custom query')
  .option('--env <environment>', 'Environment (dev, tst, prod)', 'dev')
  .option('--q <queryField>', 'Query field (email, firstName, etc.)')
  .option('--f <fields>', 'Fields to return (e.g: firstName,id,email)')
  .option('--c', 'Consolidate results into a single file and delete originals')
  .argument('[value]', 'Value to search for')
  .action(async (value, options) => {
    try {
      console.log(chalk.blue.bold('🚀 Profile Fetcher v1.0.0\n'));
      
      if (!options.q) {
        throw new Error('Query parameter --q is required (e.g: --q firstName)');
      }

      if (!value) {
        throw new Error('Search value is required (e.g: searchProfiles --q=firstName "carlos")');
      }
      
      const fetcher = new ProfileFetcher(options.env);
      await fetcher.searchProfiles(options.q, value, options.f || '', options.c || false);
      
      console.log(chalk.green.bold('🎉 Operation completed successfully!'));
    } catch (error) {
      console.error(chalk.red.bold('\n❌ Error:'), error.message);
      process.exit(1);
    }
  });

program
  .command('mineResult')
  .description('Mine data from consolidated result files')
  .option('--f <field>', 'Field to filter by')
  .argument('<inputFile>', 'Input consolidated file (e.g: profile_03-10-2025_consolidated.json)')
  .argument('[condition]', 'Filter condition')
  .action(async (inputFile, condition, options) => {
    try {
      console.log(chalk.blue.bold('⛏️  Profile Data Miner v1.0.0\n'));
      
      if (!options.f) {
        throw new Error('Field parameter --f is required (e.g: --f active)');
      }

      if (!condition) {
        throw new Error('Condition is required (e.g: true, "2020-01-01 2021-01-01", ">20", "Pedro")');
      }
      
      const fetcher = new ProfileFetcher('dev'); // Environment doesn't matter for mining
      await fetcher.mineData(inputFile, options.f, condition);
      
      console.log(chalk.green.bold('🎉 Data mining completed successfully!'));
    } catch (error) {
      console.error(chalk.red.bold('❌ Error:'), error.message);
      process.exit(1);
    }
  });

program
  .command('auth')
  .description('Test authentication in an environment')
  .option('--env <environment>', 'Environment (dev, tst, prod)', 'dev')
  .action(async (options) => {
    try {
      console.log(chalk.blue.bold('🚀 Profile Fetcher v1.0.0 - Authentication Test\n'));
      
      const fetcher = new ProfileFetcher(options.env);
      await fetcher.authenticate();
      
      console.log(chalk.green.bold('🎉 Authentication test completed successfully!'));
    } catch (error) {
      console.error(chalk.red.bold('❌ Error:'), error.message);
      process.exit(1);
    }
  });

program
  .command('searchProducts')
  .description('Search products with custom query')
  .option('--env <environment>', 'Environment (dev, tst, prod)', 'dev')
  .option('--q <query>', 'Query string (e.g: not (childSKUs pr))')
  .option('--f <fields>', 'Fields to return (e.g: id,displayName,childSKUs.repositoryId)')
  .option('--c', 'Consolidate results into a single JSON/CSV file and delete originals')
  .option('--id-list', 'Generate a simple CSV with only product IDs (one per line, no header)')
  .option('--pa-only', 'Filter only product IDs starting with "PA" (use with --id-list)')
  .action(async (options) => {
    try {
      console.log(chalk.blue.bold('🚀 Product Fetcher v1.0.0\n'));

      if (!options.q) {
        throw new Error('Query parameter --q is required (e.g: --q "not (childSKUs pr)")');
      }

      const fetcher = new ProfileFetcher(options.env);
      await fetcher.searchProducts(
        options.q,
        options.f || '',
        options.c || false,
        options.idList || false,
        options.paOnly || false
      );

      console.log(chalk.green.bold('🎉 Operation completed successfully!'));
    } catch (error) {
      console.error(chalk.red.bold('\n❌ Error:'), error.message);
      process.exit(1);
    }
  });

program
  .command('deleteProducts')
  .description('Delete products from a CSV file (auto-finds files starting with "products" in inputs/)')
  .option('--env <environment>', 'Environment (dev, tst, prod)', 'dev')
  .option('-n, --concurrency <number>', 'Number of parallel requests (1-10)', '1')
  .argument('[csvFile]', 'Optional: CSV file name in inputs folder (default: auto-find products*.csv)')
  .action(async (csvFile, options) => {
    try {
      console.log(chalk.blue.bold('🗑️  Product Deleter v1.0.0\n'));

      const concurrency = parseInt(options.concurrency) || 1;
      if (concurrency < 1 || concurrency > 10) {
        throw new Error('Concurrency must be between 1 and 10');
      }

      const fetcher = new ProfileFetcher(options.env);
      await fetcher.deleteProducts(csvFile, concurrency);

      console.log(chalk.green.bold('🎉 Deletion process completed!'));
    } catch (error) {
      console.error(chalk.red.bold('\n❌ Error:'), error.message);
      process.exit(1);
    }
  });

program.parse();
