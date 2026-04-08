#!/bin/bash
# Writes .env before Metro bundler runs so EXPO_PUBLIC_* vars get inlined into JS bundle.
echo "Creating .env file..."
cat > .env << 'EOF'
EXPO_PUBLIC_SUPABASE_URL=https://kupqzsumdesecpiijjnt.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1cHF6c3VtZGVzZWNwaWlqam50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDg2NjAsImV4cCI6MjA5MDk4NDY2MH0.MSL2cEXZMeEgqRUI3caVXQDGauGIlk-SUANR_6n2FdY
EXPO_PUBLIC_QIANWEN_API_KEY=sk-e21d8b400252441abbcc1c08afe0b647
EOF
echo ".env created successfully."
