import http.server
import socketserver
import urllib.request
import urllib.parse
import sys

PORT = 8080

class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/proxy/'):
            # Extract the actual URL
            target_url = self.path[7:] # Remove /proxy/ prefix
            if target_url.startswith('https:/') and not target_url.startswith('https://'):
                # Simple fix for double slash issue if present
                target_url = target_url.replace('https:/', 'https://', 1)
            
            print(f"Proxying request to: {target_url}")
            
            try:
                # Create request with browser-like headers to avoid blocking
                req = urllib.request.Request(
                    target_url, 
                    headers={
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
                    }
                )
                
                with urllib.request.urlopen(req) as response:
                    self.send_response(response.status)
                    # Copy headers
                    for key, value in response.headers.items():
                        if key.lower() not in ['transfer-encoding', 'content-encoding']:
                            self.send_header(key, value)
                    self.end_headers()
                    # Copy content
                    self.wfile.write(response.read())
            except Exception as e:
                self.send_error(500, f"Proxy Error: {str(e)}")
        else:
            # Serve static files normally
            super().do_GET()

print(f"Serving on port {PORT} with proxy support...")
print(f"Open http://localhost:{PORT} in your browser")

# Allow address reuse by subclassing
class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

print(f"Serving on port {PORT} with proxy support...")
print(f"Open http://localhost:{PORT} in your browser")

with ReusableTCPServer(("", PORT), ProxyHandler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
