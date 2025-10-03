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

      // Save consolidated file
      const resultFilename = `${baseName}_consolidated.json`;
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

    } catch (error) {
      spinner.fail(chalk.red('Error consolidating results'));
      console.error(chalk.red('Details:'), error.message);
      throw error;
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
