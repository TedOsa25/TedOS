#!/bin/bash

echo ""
echo "🔍 TedOS Doctor"
echo ""

echo "Checking Core Files..."

for file in MASTER.md RULES.md VISION.md README.md BOOTSTRAP.md DECISION_FRAMEWORK.md ORCHESTRATOR.md
do
    if [ -f "$file" ]; then
        echo "✅ $file"
    else
        echo "❌ Missing $file"
    fi
done

echo ""
echo "Checking folders..."

for folder in agents skills loops memory playbooks
do
    if [ -d "$folder" ]; then
        echo "✅ $folder"
    else
        echo "❌ Missing $folder"
    fi
done

echo ""
echo "Doctor finished."
