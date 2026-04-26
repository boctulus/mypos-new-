mkdir .\.claude\skills -Force
rm .\.claude\skills\* -Recurse -Force
cp .\.agent\skills\* .\.claude\skills -Recurse -Force
cp .\.agent\skills\index.md .\.claude\skills\

mkdir .\.qwen\skills -Force
rm .\.qwen\skills\* -Recurse -Force
cp .\.agent\skills\* .\.qwen\skills -Recurse -Force
cp .\.agent\skills\index.md .\.qwen\skills\

mkdir .\.opencode\skills -Force
rm .\.opencode\skills\* -Recurse -Force
cp .\.agent\skills\* .\.opencode\skills -Recurse -Force
cp .\.agent\skills\index.md .\.opencode\skills\
