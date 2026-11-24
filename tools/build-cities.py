"""Make cities.json so Satsuma can show "Beijing, CN" instead of coordinates.

Run once from the repository root:   python3 tools/build-cities.py
It downloads the GeoNames list of cities with 15,000+ people (about 25,000 places,
CC BY 4.0, https://www.geonames.org) and writes cities.json next to index.html.
The lookup then happens in the browser. No photo location is ever sent anywhere.
Pass a number to raise the population floor and shrink the file:  python3 tools/build-cities.py 100000
"""
import io, json, sys, urllib.request, zipfile

floor = int(sys.argv[1]) if len(sys.argv) > 1 else 15000
raw = urllib.request.urlopen("https://download.geonames.org/export/dump/cities15000.zip").read()
rows = zipfile.ZipFile(io.BytesIO(raw)).read("cities15000.txt").decode("utf-8").splitlines()
cities = []
for line in rows:
    f = line.split("\t")  # 1 name, 4 latitude, 5 longitude, 8 country code, 14 population
    if int(f[14] or 0) >= floor:
        cities.append([f[1], f[8], round(float(f[4]), 3), round(float(f[5]), 3)])
with open("cities.json", "w", encoding="utf-8") as out:
    json.dump({"source": "GeoNames, CC BY 4.0", "cities": cities}, out, ensure_ascii=False, separators=(",", ":"))
print(f"wrote cities.json with {len(cities)} cities")
