"""Quick diagnostic — check standard record and storage bucket."""
import os, sys
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

standard_id = sys.argv[1] if len(sys.argv) > 1 else None

# Show all standards for this user
print("=== standards table ===")
rows = supabase.table("standards").select("id, title, standard_code, file_path, extraction_status, total_chunks").execute().data
for r in rows:
    marker = " <-- THIS ONE" if r["id"] == standard_id else ""
    print(f"  {r['id']}{marker}")
    print(f"    title: {r['title']}")
    print(f"    file_path: {r['file_path']}")
    print(f"    status: {r['extraction_status']}  chunks: {r['total_chunks']}")

print("\n=== storage: standards bucket ===")
try:
    files = supabase.storage.from_("standards").list()
    if not files:
        print("  (empty)")
    for f in files:
        print(f"  {f}")
except Exception as e:
    print(f"  Error listing bucket: {e}")
