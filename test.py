import urllib.request
import json
print(urllib.request.urlopen("http://127.0.0.1:8000/frontend/app.js").getcode())
