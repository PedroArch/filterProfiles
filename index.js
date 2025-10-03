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
    profiles: '/ccadmin/v1/profiles'
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
    this.resultDir = path.join(__dirname, 'result');
    
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

  async consolidateResults(baseName, totalProfiles, consolidate = false) {
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
      const allItems = [];
      const filesToDelete = [];

      for (const filename of executionFiles) {
        const filepath = path.join(this.responsesDir, filename);
        const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        
        allItems.push(...data.items);
        filesToDelete.push(filepath);
      }

      // Create consolidated result
      const consolidatedResult = {
        total: totalProfiles,
        env: this.environment,
        items: allItems
      };

      // Save consolidated file with unique name
      const resultFilename = this.generateUniqueFilename(this.resultDir, `${baseName}_consolidated`, 'json');
      const resultFilepath = path.join(this.resultDir, resultFilename);
      
      fs.writeFileSync(resultFilepath, JSON.stringify(consolidatedResult, null, 2));
      
      // Delete original files
      filesToDelete.forEach(filepath => {
        fs.unlinkSync(filepath);
      });

      spinner.succeed(chalk.green('Results consolidated successfully!'));
      console.log(chalk.cyan(`📄 Consolidated file: ${resultFilename}`));
      console.log(chalk.cyan(`🗂️  Total items: ${chalk.bold(allItems.length)}`));
      console.log(chalk.cyan(`🗑️  Deleted ${chalk.bold(filesToDelete.length)} original files\n`));

      // Generate CSV file
      await this.generateCSV(consolidatedResult, resultFilename);

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

  generateUniqueBaseName() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const dateStr = `${day}-${month}-${year}`;
    
    // Check for existing files with the same date
    const basePattern = `profile_${dateStr}`;
    const existingFiles = fs.readdirSync(this.responsesDir)
      .filter(file => file.startsWith(basePattern) && file.endsWith('.json'));
    
    if (existingFiles.length === 0) {
      return `profile_${dateStr}`;
    }
    
    // Find the highest execution number for today
    let maxExecNumber = 0;
    existingFiles.forEach(file => {
      const match = file.match(/profile_\d{2}-\d{2}-\d{4}(\((\d+)\))?_\d+\.json/);
      if (match) {
        const execNumber = match[2] ? parseInt(match[2]) : 0;
        maxExecNumber = Math.max(maxExecNumber, execNumber);
      }
    });
    
    const nextExecNumber = maxExecNumber + 1;
    return `profile_${dateStr}(${nextExecNumber})`;
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
      const baseName = this.generateUniqueBaseName();

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
          
          // Consolidate results if requested
          await this.consolidateResults(baseName, totalProfiles, consolidate);
          
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
      
      console.log(chalk.green.bold('\n🎉 Operation completed successfully!'));
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

program.parse();
