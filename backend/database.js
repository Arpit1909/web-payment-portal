const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:50001/rest/v1/';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''; // Will be added by the user

if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠️ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env file. Database connections will fail.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
