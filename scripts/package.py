"""Package source and the production frontend without local data or dependencies."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

project = Path(__file__).resolve().parents[1]
archive = project.parent / 'crystal-studio-web-v1.zip'
excluded = {'node_modules', '.venv', '__pycache__', '.pytest_cache', '.git',
            '.agents', '.codex', '.aws', 'artifacts', 'uploads', 'private_sources',
            'exports', 'playwright-report', 'test-results', 'htmlcov', '.vite'}
files = []
for path in project.rglob('*'):
    relative = path.relative_to(project)
    if not path.is_file() or any(part in excluded for part in relative.parts):
        continue
    if (path.name == '.env' or path.name.startswith('.env.')) and path.name != '.env.example':
        continue
    if path.suffix in {'.pyc', '.pyo'} or path.name in {'.coverage', 'Thumbs.db', '.DS_Store'}:
        continue
    files.append(path)
with ZipFile(archive, 'w', compression=ZIP_DEFLATED) as bundle:
    for path in sorted(files):
        bundle.write(path, Path('crystal-studio-web') / path.relative_to(project))
with ZipFile(archive) as bundle:
    assert bundle.testzip() is None
print(f'{archive.name}: {len(files)} files, {archive.stat().st_size:,} bytes; archive verified.')
