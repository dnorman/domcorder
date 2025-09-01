function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  // Adjust for high DPI
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D context not available');
  }
  ctx.scale(dpr, dpr);
  return ctx;
}

function drawSmiley(ctx, x, y, radius, faceColor) {
  ctx.save();

  // Face
  ctx.lineWidth = 4;
  ctx.fillStyle = faceColor;
  ctx.strokeStyle = '#333';

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Eyes
  const eyeOffsetX = radius * 0.4;
  const eyeOffsetY = radius * 0.35;
  const eyeRadius = Math.max(2, radius * 0.09);

  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(x - eyeOffsetX, y - eyeOffsetY, eyeRadius, 0, Math.PI * 2);
  ctx.arc(x + eyeOffsetX, y - eyeOffsetY, eyeRadius, 0, Math.PI * 2);
  ctx.fill();

  // Smile
  ctx.beginPath();
  const smileRadius = radius * 0.6;
  ctx.lineWidth = Math.max(2, radius * 0.12);
  ctx.strokeStyle = '#333';
  ctx.arc(x, y, smileRadius, Math.PI * 0.15, Math.PI - Math.PI * 0.15);
  ctx.stroke();

  ctx.restore();
}

function drawSmileyOnCanvas(canvasId, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    throw new Error('Canvas element with id "' + canvasId + '" not found');
  }

  const ctx = setupCanvas(canvas);
  const rect = canvas.getBoundingClientRect();

  // Clear before drawing (in case of redraws)
  ctx.clearRect(0, 0, rect.width, rect.height);

  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const radius = Math.min(rect.width, rect.height) / 2 - 10;

  drawSmiley(ctx, centerX, centerY, radius, color);
}


// Run once page is loaded
window.onload = function () {
  const colors = ['lightgreen', 'lightblue', '#ffeb3b', 'pink'];
  drawSmileyOnCanvas('canvas', colors[0]);

  let colorIndex = 1;

  setInterval(() => {
    const color = colors[colorIndex];
    drawSmileyOnCanvas('canvas', color);
    colorIndex = (colorIndex + 1) % colors.length;
  }, 5000);
};