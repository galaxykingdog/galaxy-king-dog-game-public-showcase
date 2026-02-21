# How to Let Friends Play Your Game

## Quick Start (Network Access)

1. **Run the network server:**
   - Double-click `start_game_network.bat`
   - OR run: `python -m http.server 8000 --bind 0.0.0.0`

2. **Find your IP address:**
   - Open PowerShell/Command Prompt
   - Type: `ipconfig`
   - Look for "IPv4 Address" (e.g., `192.168.1.100`)

3. **Share with your friend:**
   - Give them: `http://YOUR_IP:8000`
   - Example: `http://192.168.1.100:8000`

## Important Notes:

⚠️ **Same Network Required:**
- Your friend must be on the **same WiFi/network** as you
- OR you need to set up port forwarding on your router

🌐 **For Internet Access (Different Networks):**
1. Find your **public IP**: Visit https://whatismyipaddress.com
2. Set up **port forwarding** on your router:
   - Port: 8000
   - Protocol: TCP
   - Forward to your local IP (from step 2 above)
3. Share: `http://YOUR_PUBLIC_IP:8000`

🔒 **Security Warning:**
- Only share with trusted friends
- Close the server when not in use
- Consider using a firewall

## Troubleshooting:

**Friend can't connect?**
- Check Windows Firewall: Allow Python through firewall
- Make sure both are on same network
- Try disabling firewall temporarily to test

**Windows Firewall Fix:**
1. Windows Security → Firewall & network protection
2. Allow an app through firewall
3. Add Python or allow port 8000






