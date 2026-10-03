"""Fetch source rows and their HTTP content."""
import os
from urllib.parse import urlparse

import requests

from .config import SUPABASE_URL, SUPABASE_ANON_KEY

def fetch_data():
    base_url = os.environ.get("SUPABASE_URL", SUPABASE_URL).rstrip("/")
    api_key = os.environ.get("SUPABASE_ANON_KEY", SUPABASE_ANON_KEY)
    headers = {"apikey": api_key, "Authorization": f"Bearer {api_key}"}
    rows = []
    # Supabase can limit each response; request ranges until all rows are read.
    with requests.Session() as session:
        while True:
            response = session.get(
                f"{base_url}/rest/v1/1",
                headers=headers,
                params={"select": "*", "order": "created_at.asc",
                        "offset": len(rows), "limit": 1000},
                timeout=30,
            )
            response.raise_for_status()
            page = response.json()
            if not isinstance(page, list) or any(not isinstance(row, dict) for row in page):
                raise ValueError("数据库响应应为对象数组")
            if not page:
                break
            rows.extend(page)

        results = []
        for row in rows:
            target = row.get("url")
            result = dict(row)
            result["data"] = None
            try:
                if not isinstance(target, str) or urlparse(target).scheme not in ("http", "https"):
                    raise ValueError("url 必须是有效的 HTTP/HTTPS 地址")
                # Database credentials are sent only to Supabase, never to target URLs.
                response = session.get(target, timeout=30)
                result["status_code"] = response.status_code
                response.raise_for_status()
                try:
                    result["data"] = response.json()
                except ValueError:
                    result["data"] = response.text
            except (requests.RequestException, ValueError) as error:
                result["error"] = str(error)
            results.append(result)
        return results
