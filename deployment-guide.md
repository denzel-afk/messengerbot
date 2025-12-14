# 🚀 Production Deployment Guide

Bot sudah jalan perfect di local dengan ngrok, sekarang waktunya deploy ke production!

## 📋 Pre-Deployment Checklist

- [x] Bot working locally with ngrok
- [x] Facebook webhook verified
- [x] Google Sheets integration working
- [x] All features tested (pagination, search, orders)

## 🔧 Changes Needed for Production

### 1. Environment Variables (.env)
```env
# Facebook
FACEBOOK_PAGE_ACCESS_TOKEN=your_page_access_token
FACEBOOK_VERIFY_TOKEN=your_verify_token
FACEBOOK_APP_SECRET=your_app_secret

# Google Sheets
GOOGLE_SERVICE_ACCOUNT_EMAIL=your_service_account_email
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nyour_private_key\n-----END PRIVATE KEY-----"
GOOGLE_SHEET_ID=your_sheet_id

# Server
PORT=3000
NODE_ENV=production
SUPPORT_WHATSAPP=+628123456789
```

### 2. Server Configuration
Server sudah configured untuk production:
- ✅ Dynamic PORT (process.env.PORT || 80)
- ✅ Proper error handling
- ✅ Request logging
- ✅ Auto Google Sheets initialization

## 🌐 Deployment Options

### Option 1: Railway (Easiest - Recommended)

**Pros:**
- Free tier available
- Auto-deploy from GitHub
- Built-in SSL/HTTPS
- Very easy setup

**Steps:**
1. Push code to GitHub
2. Connect Railway to GitHub repo
3. Add environment variables
4. Deploy automatically

**Cost:** Free tier: 500 hours/month, then $5/month

### Option 2: Render

**Pros:**
- Free tier available
- Auto-deploy from GitHub
- Built-in SSL

**Steps:**
1. Connect GitHub repo
2. Set build command: `npm install`
3. Set start command: `node server.js`
4. Add environment variables

**Cost:** Free tier available, then $7/month

### Option 3: Digital Ocean App Platform

**Pros:**
- More control
- Good performance
- Scalable

**Cost:** $12/month minimum

### Option 4: VPS (Digital Ocean Droplet)

**Pros:**
- Full control
- SSH access
- Can host multiple apps

**Setup:**
```bash
# On VPS
sudo apt update
sudo apt install nodejs npm nginx
git clone your-repo
cd messengerbot
npm install
npm install -g pm2

# Start with PM2 (process manager)
pm2 start server.js --name messenger-bot
pm2 startup
pm2 save

# Setup Nginx reverse proxy
sudo nano /etc/nginx/sites-available/default
```

**Cost:** $6/month (1GB RAM droplet)

## 🔄 Webhook URL Update

After deployment, you need to update Facebook webhook URL:

**Current (ngrok):** `https://503d02ee0d66.ngrok-free.app/webhook`
**Production:** `https://your-domain.com/webhook`

### Update Steps:
1. Go to Facebook Developer Console
2. Products → Webhooks
3. Edit subscription
4. Update callback URL to production URL
5. Verify webhook

## 📝 Production Checklist

### Before Deployment:
- [ ] Environment variables configured
- [ ] GitHub repo ready
- [ ] Production domain/URL decided

### After Deployment:
- [ ] Update Facebook webhook URL
- [ ] Test bot functionality
- [ ] Monitor logs for errors
- [ ] Test order flow end-to-end

## 🚨 Important Notes

1. **Environment Variables Security:**
   - Never commit .env file
   - Use platform's env variable settings
   - Keep Google private key secure

2. **Google Sheets:**
   - Service account must have access
   - Sheets must be shared with service account email

3. **Facebook App:**
   - Must be in live mode for public use
   - Webhook must use HTTPS (not HTTP)

## 📊 Monitoring

After deployment, monitor:
- Server uptime
- Error logs
- Facebook webhook delivery
- Google Sheets API limits

## 💰 Cost Comparison

| Platform | Free Tier | Paid Tier | Best For |
|----------|-----------|-----------|----------|
| Railway | 500h/month | $5/month | Beginners |
| Render | Yes | $7/month | Simple apps |
| Digital Ocean | No | $6-12/month | Full control |

## 🎯 Recommended: Railway

For your bot, saya recommend **Railway** karena:
- Paling mudah setup
- Free tier cukup untuk testing
- Auto-deploy dari GitHub
- Built-in SSL
- Good for Node.js apps

Mau saya buatkan setup file untuk Railway deployment?
