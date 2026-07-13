import json

file_path = "/Users/carbeneshen/Documents/GitHub/VoiceHub/app/pages/index.vue"

with open(file_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

end_template_idx = -1
for i, line in enumerate(lines):
    if line.strip() == "</template>":
        end_template_idx = i
        break

if end_template_idx != -1:
    with open("template_new.txt", "r", encoding="utf-8") as f:
        new_template = f.read()
    
    lines = [new_template + "\n"] + lines[end_template_idx + 1:]
    
    with open(file_path, "w", encoding="utf-8") as f:
        f.writelines(lines)
    print("Replaced template successfully")
else:
    print("Could not find </template>")
