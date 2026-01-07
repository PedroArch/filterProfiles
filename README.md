# Profile Fetcher

Node.js application to fetch profiles from Oracle Commerce Cloud API.

## Features

- Automatic authentication for dev, tst and prod environments
- Paginated profile search (250 at a time)
- Automatic saving of all responses to JSON files
- Support for different search fields (email, firstName, etc.)
- **NEW**: Data mining from consolidated results with multiple filter types
- Automatic CSV export for both search and mining results

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd filterProfiles
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env_example .env
```
Edit `.env` file with your actual Oracle Commerce Cloud credentials.

4. Make the script executable:
```bash
chmod +x index.js
chmod +x *.sh
chmod +x search_product
```

## Environment Configuration

**IMPORTANT**: Never commit the `.env` file to version control!

Copy `.env_example` to `.env` and configure with your actual values:

```bash
# Development Environment
DEV_BASE_URL=https://your-dev-instance-admin.occa.ocs.oraclecloud.com
DEV_BEARER_TOKEN=your_actual_dev_token_here

# Test Environment  
TST_BASE_URL=https://your-tst-instance-admin.occa.ocs.oraclecloud.com
TST_BEARER_TOKEN=your_actual_tst_token_here

# Production Environment
PROD_BASE_URL=https://your-prod-instance-admin.occa.ocs.oraclecloud.com
PROD_BEARER_TOKEN=your_actual_prod_token_here
```

## Usage

### Using wrapper scripts (recommended - cleanest syntax)

#### Search profiles by email (returning all fields)
```bash
./search.sh --q=email "pedro" --env=prod
```

#### Search profiles by firstName (returning only specific fields)
```bash
./search.sh --q=firstName "Pedro" --f=firstName,id,email --env=dev
```

#### Search profiles with custom fields
```bash
./search.sh --q=email "pedro.franco" --f=firstName,id --env=prod
```

#### Search products with a custom query
```bash
./search_product --q="not (childSKUs pr)" --f=id,displayName,childSKUs.repositoryId --env=prod
```

#### Test authentication
```bash
./auth.sh --env=dev
```

#### Consolidate results (combine all files into one)
```bash
./search.sh --q=firstName "Pedro" --f=firstName,id,email --c --env=dev
```

### Using npm scripts (requires -- separator)

```bash
npm run searchProfile -- --q=firstName "carlos" --f=firstName,id --env=prod
# or using the shorter alias:
npm run search -- --q=email "pedro" --env=prod

# Search products
npm run searchProduct -- --q="not (childSKUs pr)" --f=id,displayName,childSKUs.repositoryId --env=prod

# Test authentication  
npm run auth -- --env=dev

# Super short aliases (using wrapper scripts):
npm run s --q=firstName "carlos" --f=firstName,id --env=prod
npm run a --env=dev
```

**Note:** NPM requires `--` to separate npm flags from script arguments. For cleaner syntax, use the wrapper scripts below.

### Using node directly

```bash
node index.js searchProfiles --q=firstName "carlos" --env=prod
node index.js searchProducts --q="not (childSKUs pr)" --f=id,displayName,childSKUs.repositoryId --env=prod
node index.js auth --env=dev
```

## Parameters

- `--env`: Environment (dev, tst, prod) - default: dev
- `--q`: Query field (email, firstName, etc.) - required
- `value`: Search value (passed after the options) - required
- `--f`: Fields to return (comma separated, no quotes) - optional
- `--c`: Consolidate all results into a single file and delete originals - optional

## Available NPM Scripts

- `npm run searchProfile` - Full search command (requires `--`)
- `npm run search` - Shorter alias for search (requires `--`)
- `npm run auth` - Authentication test (requires `--`)
- `npm start` - Basic start command

## Recommended Usage

**✅ Best option (wrapper scripts):**
```bash
./search.sh --q=firstName "Sarah" --f=firstName,id --env=prod
./auth.sh --env=prod
```

**✅ NPM with -- separator:**
```bash
npm run searchProfile -- --q=firstName "Sarah" --f=firstName,id --env=prod
```

## Configuration

The `config.json` file contains:
- Base URLs for each environment
- Bearer tokens for initial authentication
- Request limit configurations

## Output

Response files are saved to the `responses/` folder with the format:
`profile_<DD-MM-YYYY>(_<execution_number>)_<request_number>.json`

**File naming examples:**
- First execution of the day: `profile_03-10-2025_1.json`, `profile_03-10-2025_2.json`
- Second execution: `profile_03-10-2025(1)_1.json`, `profile_03-10-2025(1)_2.json`
- Third execution: `profile_03-10-2025(2)_1.json`, `profile_03-10-2025(2)_2.json`

Each file contains:
- Total profiles found
- Request offset
- List of profiles (up to 250 per file)
- Navigation links

**Automatic file management:**
- Prevents overwriting files from multiple executions on the same day
- Sequential execution numbering in parentheses
- Each execution gets its own numbered sequence

## Data Mining

After consolidating search results, you can mine the data using various filter types.

**🧠 Smart Type Detection**: The application automatically analyzes your data fields and detects:
- **Boolean**: true/false values
- **Number**: Integers and decimals (supports >, <, >=, <=, = operators)
- **Date**: ISO dates and common formats (supports ranges)
- **String**: Text values (contains search)

### Usage Options:
```bash
# NPM command (recommended)
npm run mine -- --f=fieldName inputFile.json "condition"

# Direct command
node index.js mineResult --f=fieldName inputFile.json "condition"

# Shell script
./mine.sh inputFile.json --f=fieldName "condition"
```

### Boolean Filters (auto-detected)
```bash
npm run mine -- --f=active profile_consolidated.json "true"
npm run mine -- --f=isSubscribed profile_consolidated.json "false"
```

### Date Range Filters (auto-detected)
```bash
npm run mine -- --f=registrationDate profile_consolidated.json "2020-01-01 2023-12-31"
npm run mine -- --f=lastLoginDate profile_consolidated.json "2024-01-01 2024-12-31"
```

### Numeric Filters (auto-detected)
```bash
npm run mine -- --f=lastPurchaseAmount profile_consolidated.json ">100"
npm run mine -- --f=age profile_consolidated.json ">=18"
npm run mine -- --f=loyaltyPoints profile_consolidated.json "<1000"
npm run mine -- --f=totalOrders profile_consolidated.json "=5"
```

### String Contains Filters (auto-detected)
```bash
npm run mine -- --f=firstName profile_consolidated.json "Pedro"
npm run mine -- --f=email profile_consolidated.json "gmail"
npm run mine -- --f=city profile_consolidated.json "São Paulo"
```

### Mining Output
- `profiles_datamined_YYYY-MM-DD-HH-MM-SS.json` - Filtered data with metadata and field analysis
- `profiles_datamined_YYYY-MM-DD-HH-MM-SS.csv` - CSV format for analysis

### Smart Analysis Features
- **Type Detection**: Automatically analyzes field types from data samples
- **Validation Warnings**: Alerts when condition doesn't match detected field type
- **Field Analysis**: Shows detected type, confidence, and sample values
- **Optimized Filtering**: Uses type-specific filtering for better performance
- **Metadata Tracking**: Saves analysis details in output files

## Result Consolidation

Use the `--c` flag to consolidate all response files into a single result file:

```bash
./search.sh --q=email "carlos" --f=firstName,id,email --c --env=prod
```

**What happens with `--c`:**
1. All individual response files are processed
2. A single consolidated file is created in the `result/` folder
3. Original response files are deleted
4. Consolidated file format:
```json
{
  "total": 1234,
  "env": "prod", 
  "items": [
    // All profile items from all response files
  ]
}
```

**Consolidated file naming:**
- `profile_03-10-2025_consolidated.json`
- `profile_03-10-2025(1)_consolidated.json` 
- `profile_03-10-2025(2)_consolidated.json`

## Usage Examples

1. **Search all profiles with email containing "carlos" (all fields):**
   ```bash
   ./search.sh --q=email "carlos" --env=prod
   ```

2. **Search profiles by name returning only specific fields:**
   ```bash
   ./search.sh --q=firstName "Pedro" --f=firstName,id,email --env=tst
   ```

3. **Search specific profile by complete email:**
   ```bash
   ./search.sh --q=email "pedro.franco@objectedge.com" --f=firstName,id --env=prod
   ```

### Quick Examples

```bash
# Quick search
./search.sh --q=email "pedro" --env=prod

# Search with specific fields only
./search.sh --q=firstName "carlos" --f=firstName,id,email

# Test authentication
./auth.sh --env=prod
```

## Query Parameters

When you use `--f="firstName,id,email"`, the application automatically converts to:
`fields=items.firstName,items.id,items.email`

The final query becomes:
`/ccadmin/v1/profiles?fields=items.firstName,items.id,items.email&q=email co "pedro.franco"`

### New Syntax Benefits

- **Cleaner syntax**: `--q=firstName "carlos"` separates field and value clearly
- **No quotes on fields**: `--f=firstName,id,email` (cleaner than quoted strings)
- **Natural order**: Field specification followed by search value
- **Auto token renewal**: Tokens are automatically renewed when expired (300s lifetime)

### Token Management

The application automatically handles token expiration:
- Tokens have a 300-second (5-minute) lifetime
- Auto-renewal occurs 30 seconds before expiration
- No manual intervention needed for long-running searches
- Seamless token refresh during paginated requests

### NPM Script Syntax Note

NPM requires `--` to separate npm flags from script arguments:

**❌ Won't work:**
```bash
npm run searchProfile --q=firstName "Sarah" --f=firstName,id --env=prod
```

**✅ Works (with --):**
```bash
npm run searchProfile -- --q=firstName "Sarah" --f=firstName,id --env=prod
```

**✅ Clean alternative:**
```bash
./search.sh --q=firstName "Sarah" --f=firstName,id --env=prod
```

The application automatically:
- Logs in and obtains the access token
- Calculates how many requests are needed
- Makes all calls with appropriate offset
- Saves each response to a separate file
- Displays progress in the console
