const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Building React application...');
try {
  execSync('npm run build', { stdio: 'inherit' });
  console.log('React build completed successfully.');
  
  // Create build directory in server if it doesn't exist
  const serverBuildDir = path.join(__dirname, 'build');
  if (!fs.existsSync(serverBuildDir)) {
    fs.mkdirSync(serverBuildDir, { recursive: true });
  }
  
  // Copy build files to server directory
  console.log('Copying build files to server directory...');
  fs.cpSync('dist', 'build', { recursive: true });
  
  console.log('Build complete! You can now run the server with:');
  console.log('node server/server.js');
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
