import json

file_path = "/Users/carbeneshen/Documents/GitHub/VoiceHub/app/pages/index.vue"

with open(file_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

start_style_idx = -1
for i, line in enumerate(lines):
    if line.strip() == "<style scoped>":
        start_style_idx = i
        break

if start_style_idx != -1:
    with open("style_new.txt", "r", encoding="utf-8") as f:
        new_style = f.read()
    
    # We replace from <style scoped> to the end of the file.
    lines = lines[:start_style_idx] + [new_style + "\n"]
    
    with open(file_path, "w", encoding="utf-8") as f:
        f.writelines(lines)
    print("Replaced style successfully")
else:
    print("Could not find <style scoped>")
