import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

export async function GET() {
  try {
    const platform = os.platform();
    let command = '';

    if (platform === 'darwin') {
      command = `osascript -e 'POSIX path of (choose file with prompt "Select a local data file:")'`;
    } else if (platform === 'win32') {
      command = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Filter = 'All Files (*.*)|*.*'; $f.ShowHelp = $true; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $f.FileName } else { '' }"`;
    } else if (platform === 'linux') {
      command = `zenity --file-selection --title="Select a local data file:" || kdialog --getopenfilename`;
    } else {
      return NextResponse.json({ success: false, error: 'Unsupported operating system for native file picker.' }, { status: 400 });
    }

    const { stdout } = await execAsync(command);
    const path = stdout.trim();

    if (path) {
      return NextResponse.json({ success: true, path });
    } else {
      return NextResponse.json({ success: false, error: 'No file selected' });
    }
  } catch (error: any) {
    // If the user cancels the dialog, it usually exits with a non-zero code.
    return NextResponse.json({ success: false, error: 'User canceled file selection' });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const filePath = body?.path;

    if (!filePath || typeof filePath !== 'string') {
      return NextResponse.json({ success: false, error: 'File path is required' }, { status: 400 });
    }

    const fs = await import('fs');
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ success: false, error: `File not found: ${filePath}` }, { status: 404 });
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    try {
      const parsed = JSON.parse(content);
      return NextResponse.json(parsed);
    } catch {
      return new NextResponse(content, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Failed to read file' }, { status: 500 });
  }
}
