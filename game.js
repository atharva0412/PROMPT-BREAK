/**
 * PROMPT//BREAK
 * Comprehensive Engine, Command Interpreter, Collision Resolution & Animation Pipeline
 */

(function () {
  'use strict';

  // --- Constants & Config ---
  const CANVAS_WIDTH = 960;
  const CANVAS_HEIGHT = 540;
  const MAX_ENERGY = 10;

  const COMMAND_COSTS = {
    'CREATE PLATFORM': 2,
    'DELETE ENEMY': 3,
    'FREEZE ENEMIES': 3,
    'REVERSE GRAVITY': 2,
  };

  // --- Game State ---
  const state = {
    currentLevelIndex: 0,
    energy: MAX_ENERGY,
    isGameOver: false,
    isVictory: false,
    levelWon: false,
    gravityDir: 1, // 1: normal (down), -1: inverted (up)
    baseGravity: 0.58,
    lastTargetPoint: null,
    freezeTimer: 0,
    freezeDuration: 6.0,
    particles: [],
    floatingTexts: [],
    lockOnAnimation: null, // { startX, startY, targetX, targetY, timer, maxTimer }
    keys: {
      left: false,
      right: false,
      jump: false,
    },
    bannerTimer: null,
    enemyIdCounter: 1,
  };

  // --- DOM Elements ---
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const viewportWrapper = document.getElementById('viewport-wrapper');
  const levelValueEl = document.getElementById('level-value');
  const energyValueEl = document.getElementById('energy-value');
  const energyBarFillEl = document.getElementById('energy-bar-fill');
  const sectorTitleBadgeEl = document.getElementById('sector-title-badge');
  const feedLinesEl = document.getElementById('feed-lines');
  const commandInputEl = document.getElementById('command-input');
  const commandFormEl = document.getElementById('command-form');
  const restartBtnEl = document.getElementById('restart-btn');
  const soundToggleBtnEl = document.getElementById('sound-toggle-btn');
  const tutorialToggleBtnEl = document.getElementById('tutorial-toggle-btn');
  const tutorialModalEl = document.getElementById('tutorial-modal');
  const startGameBtnEl = document.getElementById('start-game-btn');
  const actionBannerEl = document.getElementById('action-banner');
  const bannerTextEl = document.getElementById('banner-text');
  const modalEl = document.getElementById('screen-overlay');
  const modalTitleEl = document.getElementById('modal-title');
  const modalMsgEl = document.getElementById('modal-msg');
  const modalStatsEl = document.getElementById('modal-stats');
  const modalPrimaryBtn = document.getElementById('modal-primary-btn');
  const modalSecondaryBtn = document.getElementById('modal-secondary-btn');
  const chipButtons = document.querySelectorAll('.chip-btn');

  // --- Action Notification Banner ---
  function showBanner(text, isError = false) {
    if (state.bannerTimer) {
      clearTimeout(state.bannerTimer);
    }
    bannerTextEl.textContent = text;
    actionBannerEl.querySelector('.banner-tag').textContent = isError ? 'OVERRIDE FAILED' : 'OVERRIDE CONFIRMED';

    if (isError) {
      actionBannerEl.classList.add('error-state');
    } else {
      actionBannerEl.classList.remove('error-state');
    }

    actionBannerEl.classList.remove('hidden');

    state.bannerTimer = setTimeout(() => {
      actionBannerEl.classList.add('hidden');
    }, 2400);
  }

  function triggerScreenShake() {
    viewportWrapper.classList.remove('screen-shake');
    void viewportWrapper.offsetWidth; // Force CSS reflow
    viewportWrapper.classList.add('screen-shake');
    setTimeout(() => {
      viewportWrapper.classList.remove('screen-shake');
    }, 380);
  }

  // --- Player Object ---
  const player = {
    x: 60,
    y: 380,
    width: 24,
    height: 34,
    vx: 0,
    vy: 0,
    speed: 4.8,
    jumpForce: 11.4,
    isGrounded: false,
    facing: 1,
    rotation: 0,
    targetRotation: 0,
    trail: [],
    alive: true,

    reset(x, y) {
      this.x = x;
      this.y = y;
      this.vx = 0;
      this.vy = 0;
      this.isGrounded = false;
      this.facing = 1;
      this.rotation = 0;
      this.targetRotation = 0;
      this.trail = [];
      this.alive = true;
    },

    update() {
      if (!this.alive) return;

      // Horizontal controls
      if (state.keys.left) {
        this.vx = -this.speed;
        this.facing = -1;
      } else if (state.keys.right) {
        this.vx = this.speed;
        this.facing = 1;
      } else {
        this.vx *= 0.72;
        if (Math.abs(this.vx) < 0.1) this.vx = 0;
      }

      // Jump: when gravity is inverted, jump pushes DOWN towards floor (away from ceiling)
      if (state.keys.jump && this.isGrounded) {
        this.vy = -this.jumpForce * state.gravityDir;
        this.isGrounded = false;
        window.soundSystem.playJump();
        createBurst(
          this.x + this.width / 2,
          this.y + (state.gravityDir > 0 ? this.height : 0),
          '#00f3ff',
          10
        );
      }

      // Apply Gravity
      this.vy += state.baseGravity * state.gravityDir;
      if (Math.abs(this.vy) > 16) {
        this.vy = 16 * Math.sign(this.vy);
      }

      // Move X & Resolve collisions
      this.x += this.vx;
      this.resolveCollisionX();

      // Move Y & Resolve collisions
      this.y += this.vy;
      this.isGrounded = false;
      this.resolveCollisionY();

      // Bounds checking (Abyss fall)
      if (this.y > CANVAS_HEIGHT + 80 || this.y < -100) {
        triggerDeath('FELL INTO THE QUANTUM ABYSS');
      }

      // Smooth rotation when gravity flips
      this.targetRotation = state.gravityDir < 0 ? Math.PI : 0;
      this.rotation += (this.targetRotation - this.rotation) * 0.22;

      // Player particle trails
      if (Math.abs(this.vx) > 0.4 || Math.abs(this.vy) > 0.8) {
        this.trail.unshift({
          x: this.x + this.width / 2,
          y: this.y + this.height / 2,
          alpha: 0.65,
        });
        if (this.trail.length > 8) this.trail.pop();
      } else if (this.trail.length > 0) {
        this.trail.pop();
      }
    },

    getAllSolids() {
      const currentLevel = levels[state.currentLevelIndex];
      const solids = [...currentLevel.platforms, ...dynamicPlatforms];

      // Frozen enemies act as solid stepping platforms!
      for (const enemy of enemies) {
        if (enemy.isFrozen && !enemy.dying) {
          solids.push({
            x: enemy.x,
            y: enemy.y,
            width: enemy.width,
            height: enemy.height,
            isEnemyPlatform: true,
          });
        }
      }
      return solids;
    },

    resolveCollisionX() {
      const allPlatforms = this.getAllSolids();
      for (const p of allPlatforms) {
        if (checkRectOverlap(this, p)) {
          if (this.vx > 0) {
            this.x = p.x - this.width;
          } else if (this.vx < 0) {
            this.x = p.x + p.width;
          }
          this.vx = 0;
        }
      }
    },

    resolveCollisionY() {
      const allPlatforms = this.getAllSolids();
      for (const p of allPlatforms) {
        if (checkRectOverlap(this, p)) {
          if (state.gravityDir > 0) {
            // Normal gravity falling downward
            if (this.vy > 0) {
              this.y = p.y - this.height;
              this.vy = 0;
              this.isGrounded = true;
            } else if (this.vy < 0) {
              this.y = p.y + p.height;
              this.vy = 0;
            }
          } else {
            // Inverted gravity falling upward towards ceiling
            if (this.vy < 0) {
              this.y = p.y + p.height;
              this.vy = 0;
              this.isGrounded = true;
            } else if (this.vy > 0) {
              this.y = p.y - this.height;
              this.vy = 0;
            }
          }
        }
      }
    },

    draw(ctx) {
      if (!this.alive) return;

      // Draw trails
      for (let i = 0; i < this.trail.length; i++) {
        const t = this.trail[i];
        ctx.fillStyle = `rgba(0, 243, 255, ${t.alpha * (1 - i / this.trail.length)})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 4.5 * (1 - i / this.trail.length), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.save();
      ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
      ctx.rotate(this.rotation);

      // Cyber Body
      ctx.shadowColor = '#00f3ff';
      ctx.shadowBlur = 14;

      // Outer suit armor
      ctx.fillStyle = '#0e1424';
      ctx.strokeStyle = '#00f3ff';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 4);
      ctx.fill();
      ctx.stroke();

      // Glowing Visor
      ctx.fillStyle = '#00f3ff';
      const visorWidth = 10;
      const visorHeight = 6;
      const visorX = this.facing > 0 ? 0 : -visorWidth;
      ctx.fillRect(visorX, -this.height / 2 + 5, visorWidth, visorHeight);

      // Core pulsing energy reactor
      const glowAmt = 0.5 + 0.5 * Math.sin(Date.now() * 0.009);
      ctx.fillStyle = `rgba(255, 0, 85, ${0.4 + 0.6 * glowAmt})`;
      ctx.beginPath();
      ctx.arc(0, 2, 4, 0, Math.PI * 2);
      ctx.fill();

      // Thruster flare when airborne
      if (!this.isGrounded) {
        ctx.fillStyle = '#ffd700';
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 10;
        const thrusterY = this.height / 2;
        ctx.fillRect(-this.width / 2 + 3, thrusterY, 6, 5);
        ctx.fillRect(this.width / 2 - 9, thrusterY, 6, 5);
      }

      ctx.restore();
    },
  };

  // --- Dynamic Platforms & Enemies ---
  let dynamicPlatforms = [];
  let enemies = [];

  // --- 3 Well-Balanced Progressive Levels ---
  const levels = [
    // LEVEL 1: Subroutine Alpha (Tutorial & Intro)
    {
      name: 'Sector 01: Subroutine Alpha',
      badge: 'SECTOR 01: SUBROUTINE ALPHA',
      hint: 'Tutorial sector: Cross the gap using "CREATE PLATFORM", then freeze or delete the drone.',
      spawn: { x: 50, y: 380 },
      exit: { x: 880, y: 160, width: 38, height: 52 },
      tutorialSigns: [
        { x: 320, y: 390, text: '💡 [!] GAP TOO WIDE: USE "CREATE PLATFORM"' },
        { x: 540, y: 360, text: '💡 [!] SENTINEL: USE "FREEZE" OR "DELETE"' },
      ],
      platforms: [
        { x: 0, y: 440, width: 280, height: 100, color: '#162238' },
        { x: 440, y: 440, width: 220, height: 100, color: '#162238' },
        { x: 700, y: 340, width: 100, height: 18, color: '#1a2a44' },
        { x: 830, y: 220, width: 130, height: 22, color: '#162238' },
      ],
      hazards: [
        { x: 280, y: 510, width: 160, height: 30, type: 'laser' },
        { x: 660, y: 510, width: 300, height: 30, type: 'laser' },
      ],
      enemies: [
        {
          x: 460,
          y: 406,
          width: 28,
          height: 28,
          minX: 440,
          maxX: 630,
          vx: 1.5,
          type: 'ground',
        },
      ],
    },

    // LEVEL 2: Neural Matrix (Verticality & Gravity Inversion)
    {
      name: 'Sector 02: Neural Matrix',
      badge: 'SECTOR 02: NEURAL MATRIX',
      hint: 'High-voltage floor laser grid! Use "REVERSE GRAVITY" to invert and run on the ceiling.',
      spawn: { x: 60, y: 410 },
      exit: { x: 890, y: 390, width: 38, height: 52 },
      tutorialSigns: [
        { x: 200, y: 380, text: '🔄 FLOOR IS LETHAL: EXECUTE "REVERSE GRAVITY"' },
        { x: 460, y: 150, text: '⚡ CEILING CONDUIT: RUN UPSIDE DOWN' },
      ],
      platforms: [
        { x: 0, y: 460, width: 170, height: 80, color: '#162238' },
        { x: 140, y: 0, width: 720, height: 45, color: '#1a2a44' },
        { x: 260, y: 95, width: 90, height: 18, color: '#162238' },
        { x: 440, y: 130, width: 100, height: 18, color: '#162238' },
        { x: 620, y: 95, width: 90, height: 18, color: '#162238' },
        { x: 380, y: 310, width: 100, height: 20, color: '#162238' },
        { x: 840, y: 450, width: 120, height: 90, color: '#162238' },
      ],
      hazards: [
        { x: 170, y: 490, width: 670, height: 50, type: 'laser' },
      ],
      enemies: [
        {
          x: 320,
          y: 55,
          width: 26,
          height: 26,
          minX: 200,
          maxX: 440,
          vx: 2.0,
          type: 'ground',
        },
        {
          x: 520,
          y: 230,
          width: 26,
          height: 26,
          minX: 400,
          maxX: 680,
          vx: 2.2,
          type: 'flyer',
          baseY: 230,
        },
      ],
    },

    // LEVEL 3: Core Overload (High Security & Prompt Synergy)
    {
      name: 'Sector 03: Core Overload',
      badge: 'SECTOR 03: CORE OVERLOAD',
      hint: 'The AI core is collapsing. Stack platforms or freeze sentinels to use them as stepping stones!',
      spawn: { x: 50, y: 420 },
      exit: { x: 890, y: 75, width: 42, height: 55 },
      tutorialSigns: [
        { x: 180, y: 380, text: '❄️ TIP: FROZEN ENEMIES BECOME SOLID PLATFORMS!' },
      ],
      platforms: [
        { x: 0, y: 470, width: 150, height: 70, color: '#162238' },
        { x: 280, y: 200, width: 40, height: 340, color: '#1a2a44' },
        { x: 390, y: 380, width: 150, height: 20, color: '#162238' },
        { x: 610, y: 260, width: 130, height: 20, color: '#162238' },
        { x: 840, y: 135, width: 120, height: 25, color: '#1a2a44' },
        { x: 0, y: 0, width: 960, height: 24, color: '#162238' },
      ],
      hazards: [
        { x: 150, y: 520, width: 810, height: 20, type: 'laser' },
      ],
      enemies: [
        {
          x: 210,
          y: 330,
          width: 26,
          height: 26,
          minX: 160,
          maxX: 260,
          vx: 2.4,
          type: 'flyer',
          baseY: 330,
        },
        {
          x: 410,
          y: 350,
          width: 28,
          height: 28,
          minX: 390,
          maxX: 520,
          vx: 2.6,
          type: 'ground',
        },
        {
          x: 640,
          y: 190,
          width: 26,
          height: 26,
          minX: 580,
          maxX: 790,
          vx: 3.0,
          type: 'flyer',
          baseY: 190,
        },
      ],
    },
  ];

  // --- Helper Functions ---
  function checkRectOverlap(r1, r2) {
    return (
      r1.x < r2.x + r2.width &&
      r1.x + r1.width > r2.x &&
      r1.y < r2.y + r2.height &&
      r1.y + r1.height > r2.y
    );
  }

  function logFeed(msg, type = 'info') {
    const line = document.createElement('div');
    line.className = `feed-line ${type}`;
    line.textContent = `> ${msg}`;
    feedLinesEl.appendChild(line);

    while (feedLinesEl.children.length > 5) {
      feedLinesEl.removeChild(feedLinesEl.firstChild);
    }
    feedLinesEl.scrollTop = feedLinesEl.scrollHeight;
  }

  function addFloatingText(x, y, text, color = '#00f3ff') {
    state.floatingTexts.push({
      x,
      y,
      text,
      color,
      life: 55,
      maxLife: 55,
    });
  }

  function createBurst(x, y, color = '#00f3ff', count = 14) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 3.8;
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.5 + Math.random() * 3,
        color,
        life: 25 + Math.random() * 20,
        maxLife: 45,
      });
    }
  }

  // --- Level Management ---
  function loadLevel(index) {
    if (index >= levels.length) {
      triggerFinalVictory();
      return;
    }

    state.currentLevelIndex = index;
    const level = levels[index];

    // Reset Energy to 10 EP
    state.energy = MAX_ENERGY;
    state.isGameOver = false;
    state.levelWon = false;
    state.gravityDir = 1;
    state.freezeTimer = 0;
    state.lastTargetPoint = null;
    state.lockOnAnimation = null;
    dynamicPlatforms = [];

    // Clone enemies with unique IDs
    enemies = level.enemies.map((e) => ({
      ...e,
      id: state.enemyIdCounter++,
      initialX: e.x,
      initialY: e.y,
      isFrozen: false,
      dying: false,
    }));

    // Reset Player
    player.reset(level.spawn.x, level.spawn.y);

    // Update UI HUD
    levelValueEl.textContent = `${index + 1} / ${levels.length}`;
    sectorTitleBadgeEl.textContent = level.badge;
    updateEnergyUI();
    hideModal();

    logFeed(`ENGAGING ${level.name.toUpperCase()}...`, 'info');
    logFeed(level.hint, 'info');
  }

  function updateEnergyUI() {
    energyValueEl.textContent = `${state.energy} / ${MAX_ENERGY}`;
    const pct = Math.max(0, Math.min(100, (state.energy / MAX_ENERGY) * 100));
    energyBarFillEl.style.width = `${pct}%`;

    if (state.energy <= 2) {
      energyBarFillEl.style.background = '#ff0055';
    } else if (state.energy <= 5) {
      energyBarFillEl.style.background = '#ffd700';
    } else {
      energyBarFillEl.style.background = 'linear-gradient(90deg, #ff0055 0%, #ffd700 45%, #00f3ff 100%)';
    }
  }

  function spendEnergy(cost) {
    if (state.energy < cost) {
      const msg = `INSUFFICIENT ENERGY! REQUIRES ${cost} EP, CURRENT: ${state.energy} EP`;
      logFeed(msg, 'error');
      showBanner(`FAILED: INSUFFICIENT ENERGY (${cost} EP NEEDED)`, true);
      window.soundSystem.playError();
      return false;
    }

    state.energy -= cost;
    updateEnergyUI();

    // Energy zero loss condition
    if (state.energy <= 0) {
      state.energy = 0;
      updateEnergyUI();
      logFeed('WARNING: SYSTEM ENERGY AT 0 EP - SYSTEM OVERLOAD!', 'error');
      setTimeout(() => {
        if (!state.levelWon && !state.isGameOver) {
          triggerDeath('ENERGY DEPLETED (0 EP) - SYSTEM SHUTDOWN');
        }
      }, 400);
    }
    return true;
  }

  // --- Prompt Interpreter & Commands ---
  function executeCommand(rawPrompt) {
    if (state.isGameOver || state.levelWon) return;

    const prompt = (rawPrompt || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!prompt) return;

    window.soundSystem.init();

    // 1. CREATE PLATFORM
    if (
      prompt === 'CREATE PLATFORM' ||
      prompt === 'PLATFORM' ||
      prompt === 'BUILD PLATFORM' ||
      prompt === 'NEW PLATFORM'
    ) {
      const cost = COMMAND_COSTS['CREATE PLATFORM'];
      if (!spendEnergy(cost)) return;

      let spawnX, spawnY;
      if (state.lastTargetPoint) {
        spawnX = Math.round(state.lastTargetPoint.x - 52);
        spawnY = Math.round(state.lastTargetPoint.y - 8);
        state.lastTargetPoint = null;
      } else {
        spawnX = Math.round(player.x + (player.facing > 0 ? 65 : -115));
        spawnY = Math.round(player.y + (state.gravityDir > 0 ? 32 : -18));
      }

      spawnX = Math.max(10, Math.min(CANVAS_WIDTH - 115, spawnX));
      spawnY = Math.max(20, Math.min(CANVAS_HEIGHT - 35, spawnY));

      const newPlat = {
        x: spawnX,
        y: spawnY,
        width: 105,
        height: 16,
        color: '#00f3ff',
        isDynamic: true,
        spawnProgress: 0,
      };
      dynamicPlatforms.push(newPlat);

      // If newly spawned platform overlaps player, nudge player safely on top
      if (checkRectOverlap(player, newPlat)) {
        if (state.gravityDir > 0) {
          player.y = newPlat.y - player.height;
        } else {
          player.y = newPlat.y + newPlat.height;
        }
        player.vy = 0;
        player.isGrounded = true;
      }

      window.soundSystem.playPlatformCreate();
      createBurst(spawnX + 52, spawnY + 8, '#00f3ff', 18);
      addFloatingText(spawnX + 52, spawnY - 12, '+PLATFORM CONSTRUCTED', '#00f3ff');
      logFeed(`PLATFORM MATERIALIZED AT [${spawnX}, ${spawnY}] (-${cost} EP)`, 'success');
      showBanner(`PLATFORM CREATED AT [${spawnX}, ${spawnY}] (-${cost} EP)`);
      return;
    }

    // 2. DELETE ENEMY
    if (
      prompt === 'DELETE ENEMY' ||
      prompt === 'DELETE' ||
      prompt === 'KILL ENEMY' ||
      prompt === 'DESTROY ENEMY' ||
      prompt === 'PURGE'
    ) {
      const cost = COMMAND_COSTS['DELETE ENEMY'];
      const activeEnemies = enemies.filter((e) => !e.dying);

      if (activeEnemies.length === 0) {
        logFeed('NO ACTIVE SENTINEL TARGETS IN RANGE. EP REFUNDED.', 'warn');
        showBanner('NO SENTINEL TARGETS DETECTED (EP SAVED)', true);
        window.soundSystem.playError();
        return;
      }

      if (!spendEnergy(cost)) return;

      // Find nearest active enemy to player
      let target = activeEnemies[0];
      let minDist = Math.hypot(target.x - player.x, target.y - player.y);

      for (let i = 1; i < activeEnemies.length; i++) {
        const e = activeEnemies[i];
        const dist = Math.hypot(e.x - player.x, e.y - player.y);
        if (dist < minDist) {
          minDist = dist;
          target = e;
        }
      }

      // Mark dying immediately to prevent double-target or wrongful collision
      target.dying = true;
      target.isFrozen = false;

      // Lock-on targeting laser beam animation
      state.lockOnAnimation = {
        startX: player.x + player.width / 2,
        startY: player.y + player.height / 2,
        targetX: target.x + target.width / 2,
        targetY: target.y + target.height / 2,
        timer: 14,
        maxTimer: 14,
      };

      triggerScreenShake();
      window.soundSystem.playDeleteEnemy();

      setTimeout(() => {
        // Vaporize target
        enemies = enemies.filter((e) => e.id !== target.id);
        createBurst(target.x + target.width / 2, target.y + target.height / 2, '#ff0055', 28);
        addFloatingText(target.x + target.width / 2, target.y - 12, 'SENTINEL VAPORIZED', '#ff0055');
        logFeed(`SENTINEL PURGED WITH LOCK-ON LASER (-${cost} EP)`, 'success');
        showBanner(`SENTINEL PURGED WITH LOCK-ON LASER (-${cost} EP)`);
      }, 100);

      return;
    }

    // 3. FREEZE ENEMIES
    if (
      prompt === 'FREEZE ENEMIES' ||
      prompt === 'FREEZE ENEMY' ||
      prompt === 'FREEZE' ||
      prompt === 'STASIS'
    ) {
      const cost = COMMAND_COSTS['FREEZE ENEMIES'];
      const activeEnemies = enemies.filter((e) => !e.dying);

      if (activeEnemies.length === 0) {
        logFeed('NO SENTINEL TARGETS TO FREEZE. EP REFUNDED.', 'warn');
        showBanner('NO ENEMIES DETECTED TO FREEZE', true);
        window.soundSystem.playError();
        return;
      }

      if (!spendEnergy(cost)) return;

      state.freezeTimer = state.freezeDuration;
      activeEnemies.forEach((e) => {
        e.isFrozen = true;
        createBurst(e.x + e.width / 2, e.y + e.height / 2, '#00f3ff', 16);
        addFloatingText(e.x + e.width / 2, e.y - 14, '❄️ STASIS LOCKED', '#00f3ff');
      });

      window.soundSystem.playFreeze();
      logFeed(`ALL SENTINELS FROZEN IN STASIS FOR ${state.freezeDuration}s (-${cost} EP)`, 'success');
      showBanner(`STASIS PROTOCOL: DRONES FROZEN FOR ${state.freezeDuration}s (-${cost} EP)`);
      return;
    }

    // 4. REVERSE GRAVITY
    if (
      prompt === 'REVERSE GRAVITY' ||
      prompt === 'GRAVITY' ||
      prompt === 'FLIP GRAVITY' ||
      prompt === 'INVERT GRAVITY'
    ) {
      const cost = COMMAND_COSTS['REVERSE GRAVITY'];
      if (!spendEnergy(cost)) return;

      state.gravityDir = -state.gravityDir;
      triggerScreenShake();
      window.soundSystem.playGravityFlip();

      createBurst(player.x + player.width / 2, player.y + player.height / 2, '#ffd700', 20);
      addFloatingText(
        player.x + player.width / 2,
        player.y - 16,
        state.gravityDir < 0 ? '▲ GRAVITY INVERTED' : '▼ GRAVITY NORMALIZED',
        '#ffd700'
      );

      const directionText = state.gravityDir < 0 ? 'CEILING' : 'FLOOR';
      logFeed(`GRAVITATIONAL VECTOR INVERTED TO ${directionText} (-${cost} EP)`, 'success');
      showBanner(`GRAVITY INVERTED TO ${directionText} (-${cost} EP)`);
      return;
    }

    // Unknown command feedback
    window.soundSystem.playError();
    logFeed(`UNKNOWN PROMPT: "${prompt}". USE COMMAND DECK.`, 'warn');
    showBanner(`UNKNOWN PROMPT: "${prompt}" - CHECK MANUAL`, true);
  }

  // --- Win / Loss Triggers ---
  function triggerDeath(reason) {
    if (state.isGameOver || state.levelWon) return;
    state.isGameOver = true;
    player.alive = false;

    triggerScreenShake();
    window.soundSystem.playDeath();
    createBurst(player.x + player.width / 2, player.y + player.height / 2, '#ff0055', 35);
    logFeed(`FATAL ANOMALY: ${reason}`, 'error');
    showBanner(`FATAL: ${reason}`, true);

    setTimeout(() => {
      showModal({
        title: 'SYSTEM CORRUPTED',
        headingClass: '',
        msg: reason,
        stats: `Sector ${state.currentLevelIndex + 1} // EP Remaining: ${state.energy}`,
        primaryText: 'RETRY SECTOR',
        onPrimary: () => loadLevel(state.currentLevelIndex),
        showSecondary: false,
      });
    }, 450);
  }

  function triggerLevelWin() {
    if (state.levelWon || state.isGameOver) return;
    state.levelWon = true;

    window.soundSystem.playWinSector();
    logFeed(`QUANTUM GATEWAY BREACHED! SECTOR ${state.currentLevelIndex + 1} CLEARED.`, 'success');
    showBanner(`GATEWAY BREACHED! SECTOR ${state.currentLevelIndex + 1} CLEARED`);

    createBurst(player.x + player.width / 2, player.y + player.height / 2, '#00ff88', 40);

    setTimeout(() => {
      if (state.currentLevelIndex + 1 < levels.length) {
        showModal({
          title: 'SECTOR COMPLETED',
          headingClass: 'victory',
          msg: `Neural pathway breached successfully. Proceeding to Sector ${state.currentLevelIndex + 2}.`,
          stats: `Integrity Preserved: ${state.energy} EP`,
          primaryText: 'NEXT SECTOR ➔',
          onPrimary: () => loadLevel(state.currentLevelIndex + 1),
          showSecondary: false,
        });
      } else {
        triggerFinalVictory();
      }
    }, 450);
  }

  function triggerFinalVictory() {
    state.isVictory = true;
    state.levelWon = true;
    window.soundSystem.playWinSector();

    showModal({
      title: 'SIMULATION OVERRIDDEN',
      headingClass: 'victory',
      msg: 'All 3 security sectors breached! You successfully escaped the AI matrix using neural prompt injection.',
      stats: 'STATUS: CONSCIOUSNESS EXTRACTED // FREEDOM ACHIEVED',
      primaryText: 'PLAY AGAIN ↺',
      onPrimary: () => loadLevel(0),
      showSecondary: false,
    });
  }

  // --- Modal Helpers ---
  let primaryModalAction = null;
  let secondaryModalAction = null;

  function showModal({ title, headingClass, msg, stats, primaryText, onPrimary, showSecondary, secondaryText, onSecondary }) {
    modalTitleEl.textContent = title;
    modalTitleEl.className = `modal-heading ${headingClass || ''}`;
    modalMsgEl.textContent = msg;
    modalStatsEl.textContent = stats || '';
    modalPrimaryBtn.textContent = primaryText;
    primaryModalAction = onPrimary;

    if (showSecondary) {
      modalSecondaryBtn.classList.remove('hidden');
      modalSecondaryBtn.textContent = secondaryText;
      secondaryModalAction = onSecondary;
    } else {
      modalSecondaryBtn.classList.add('hidden');
    }

    modalEl.classList.remove('hidden');
  }

  function hideModal() {
    modalEl.classList.add('hidden');
  }

  modalPrimaryBtn.addEventListener('click', () => {
    if (primaryModalAction) primaryModalAction();
  });

  modalSecondaryBtn.addEventListener('click', () => {
    if (secondaryModalAction) secondaryModalAction();
  });

  // --- Enemy Updates ---
  function updateEnemies(dt) {
    if (state.freezeTimer > 0) {
      state.freezeTimer -= dt;
      if (state.freezeTimer <= 0) {
        state.freezeTimer = 0;
        enemies.forEach((e) => {
          e.isFrozen = false;
        });
        logFeed('STASIS FIELD EXPIRED. SENTINELS RESUMED PATROL.', 'warn');
        showBanner('STASIS EXPIRED: DRONES ACTIVE AGAIN', true);
      }
    }

    for (const enemy of enemies) {
      if (enemy.dying) continue;

      if (!enemy.isFrozen) {
        enemy.x += enemy.vx;
        if (enemy.x > enemy.maxX) {
          enemy.x = enemy.maxX;
          enemy.vx *= -1;
        } else if (enemy.x < enemy.minX) {
          enemy.x = enemy.minX;
          enemy.vx *= -1;
        }

        if (enemy.type === 'flyer' && enemy.baseY !== undefined) {
          enemy.y = enemy.baseY + Math.sin(Date.now() * 0.005 + enemy.minX) * 16;
        }
      }

      // Check collision with player
      if (player.alive && checkRectOverlap(player, enemy)) {
        if (!enemy.isFrozen) {
          triggerDeath('CONTACT WITH HOSTILE SENTINEL DRONE');
          return;
        }
      }
    }
  }

  // --- Hazard Updates & Exit Check ---
  function checkHazardsAndExit() {
    if (!player.alive) return;

    const currentLevel = levels[state.currentLevelIndex];

    for (const h of currentLevel.hazards) {
      if (checkRectOverlap(player, h)) {
        triggerDeath('INCINERATED BY HIGH-VOLTAGE LASER CONDUIT');
        return;
      }
    }

    if (checkRectOverlap(player, currentLevel.exit)) {
      triggerLevelWin();
    }
  }

  // --- Rendering Functions ---
  function drawBackground() {
    ctx.fillStyle = '#06080e';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Dynamic grid
    ctx.strokeStyle = 'rgba(0, 243, 255, 0.04)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < CANVAS_WIDTH; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y < CANVAS_HEIGHT; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      ctx.stroke();
    }

    // Gravitational vector flow arrows in background
    ctx.save();
    ctx.fillStyle = 'rgba(0, 243, 255, 0.035)';
    const arrowDir = state.gravityDir > 0 ? '▼' : '▲';
    ctx.font = '22px "Share Tech Mono"';
    ctx.textAlign = 'center';
    for (let ax = 80; ax < CANVAS_WIDTH; ax += 180) {
      for (let ay = 60; ay < CANVAS_HEIGHT; ay += 120) {
        ctx.fillText(arrowDir, ax, ay);
      }
    }
    ctx.restore();

    // Horizon glow
    const grad = ctx.createRadialGradient(
      CANVAS_WIDTH / 2,
      state.gravityDir > 0 ? CANVAS_HEIGHT : 0,
      10,
      CANVAS_WIDTH / 2,
      state.gravityDir > 0 ? CANVAS_HEIGHT : 0,
      400
    );
    grad.addColorStop(0, 'rgba(0, 243, 255, 0.06)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  function drawTutorialSigns() {
    const signs = levels[state.currentLevelIndex].tutorialSigns;
    if (!signs) return;

    ctx.save();
    ctx.font = 'bold 11px "Share Tech Mono"';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0, 243, 255, 0.85)';
    ctx.shadowColor = '#00f3ff';
    ctx.shadowBlur = 8;

    signs.forEach((s) => {
      const hoverY = s.y + Math.sin(Date.now() * 0.004 + s.x) * 3;
      ctx.fillText(s.text, s.x, hoverY);
    });
    ctx.restore();
  }

  function drawPlatforms() {
    const currentLevel = levels[state.currentLevelIndex];

    // Static platforms
    for (const p of currentLevel.platforms) {
      ctx.save();
      ctx.fillStyle = p.color || '#162846';
      ctx.fillRect(p.x, p.y, p.width, p.height);

      ctx.strokeStyle = 'rgba(0, 243, 255, 0.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.width, p.y);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x + 1, p.y + 1, p.width - 2, p.height - 2);
      ctx.restore();
    }

    // Dynamic Platforms with spawn animation & wireframe
    for (const p of dynamicPlatforms) {
      ctx.save();
      if (p.spawnProgress < 1) {
        p.spawnProgress = Math.min(1, p.spawnProgress + 0.08);
      }

      const drawW = p.width * p.spawnProgress;
      const drawX = p.x + (p.width - drawW) / 2;

      ctx.fillStyle = 'rgba(0, 243, 255, 0.28)';
      ctx.strokeStyle = '#00f3ff';
      ctx.shadowColor = '#00f3ff';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2;

      ctx.fillRect(drawX, p.y, drawW, p.height);
      ctx.strokeRect(drawX, p.y, drawW, p.height);

      // Holographic cyber grid lines
      ctx.strokeStyle = 'rgba(0, 243, 255, 0.6)';
      ctx.lineWidth = 1;
      for (let gx = drawX + 8; gx < drawX + drawW; gx += 14) {
        ctx.beginPath();
        ctx.moveTo(gx, p.y);
        ctx.lineTo(gx, p.y + p.height);
        ctx.stroke();
      }

      // Corner tech indicators
      ctx.fillStyle = '#fff';
      ctx.fillRect(drawX, p.y, 3, 3);
      ctx.fillRect(drawX + drawW - 3, p.y, 3, 3);
      ctx.fillRect(drawX, p.y + p.height - 3, 3, 3);
      ctx.fillRect(drawX + drawW - 3, p.y + p.height - 3, 3, 3);

      ctx.restore();
    }
  }

  function drawHazards() {
    const currentLevel = levels[state.currentLevelIndex];
    for (const h of currentLevel.hazards) {
      ctx.save();
      const pulse = 0.6 + 0.4 * Math.sin(Date.now() * 0.015);
      ctx.fillStyle = `rgba(255, 0, 85, ${0.4 * pulse})`;
      ctx.fillRect(h.x, h.y, h.width, h.height);

      ctx.strokeStyle = '#ff0055';
      ctx.shadowColor = '#ff0055';
      ctx.shadowBlur = 15;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(h.x, h.y + h.height / 2);
      ctx.lineTo(h.x + h.width, h.y + h.height / 2);
      ctx.stroke();

      if (Math.random() < 0.35) {
        const sparkX = h.x + Math.random() * h.width;
        ctx.fillStyle = '#fff';
        ctx.fillRect(sparkX, h.y + h.height / 2 - 2, 4, 4);
      }
      ctx.restore();
    }
  }

  function drawExitPortal() {
    const exit = levels[state.currentLevelIndex].exit;
    ctx.save();
    const cx = exit.x + exit.width / 2;
    const cy = exit.y + exit.height / 2;
    const time = Date.now() * 0.004;

    ctx.shadowColor = '#00f3ff';
    ctx.shadowBlur = 24;

    for (let r = 0; r < 3; r++) {
      const radius = (exit.width / 2) * (0.6 + r * 0.25) + Math.sin(time + r) * 2;
      ctx.strokeStyle = r % 2 === 0 ? '#00f3ff' : '#00ff88';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius * 0.8, radius * 1.3, time * (r % 2 === 0 ? 1 : -1), 0, Math.PI * 2);
      ctx.stroke();
    }

    const coreGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, exit.width / 2);
    coreGrad.addColorStop(0, '#ffffff');
    coreGrad.addColorStop(0.4, '#00f3ff');
    coreGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, exit.width / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.font = 'bold 10px "Share Tech Mono"';
    ctx.fillStyle = '#00ff88';
    ctx.textAlign = 'center';
    ctx.fillText('EXIT GATEWAY', cx, exit.y - 12);
    ctx.restore();
  }

  function drawEnemies() {
    for (const enemy of enemies) {
      if (enemy.dying) continue;

      ctx.save();
      const cx = enemy.x + enemy.width / 2;
      const cy = enemy.y + enemy.height / 2;

      if (enemy.isFrozen) {
        // Crystalline Stasis Cage
        ctx.shadowColor = '#00f3ff';
        ctx.shadowBlur = 18;
        ctx.fillStyle = 'rgba(0, 243, 255, 0.45)';
        ctx.strokeStyle = '#00f3ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(enemy.x - 4, enemy.y - 4, enemy.width + 8, enemy.height + 8);
        ctx.fillRect(enemy.x - 4, enemy.y - 4, enemy.width + 8, enemy.height + 8);

        // Stasis countdown timer display
        ctx.font = 'bold 12px "Share Tech Mono"';
        ctx.fillStyle = '#00f3ff';
        ctx.textAlign = 'center';
        ctx.fillText(`❄️ ${state.freezeTimer.toFixed(1)}s`, cx, enemy.y - 10);
      }

      ctx.shadowColor = enemy.isFrozen ? '#00f3ff' : '#ff0055';
      ctx.shadowBlur = 12;
      ctx.fillStyle = enemy.isFrozen ? '#122e3d' : '#2b0f19';
      ctx.strokeStyle = enemy.isFrozen ? '#00f3ff' : '#ff0055';
      ctx.lineWidth = 1.6;

      if (enemy.type === 'flyer') {
        ctx.beginPath();
        ctx.moveTo(cx, enemy.y);
        ctx.lineTo(enemy.x + enemy.width, cy);
        ctx.lineTo(cx, enemy.y + enemy.height);
        ctx.lineTo(enemy.x, cy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = enemy.isFrozen ? '#00f3ff' : '#ff0055';
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
        ctx.strokeRect(enemy.x, enemy.y, enemy.width, enemy.height);

        ctx.fillStyle = enemy.isFrozen ? '#00f3ff' : '#ff0055';
        const eyeOffset = enemy.vx > 0 ? 4 : -4;
        ctx.fillRect(cx + eyeOffset - 3, cy - 3, 6, 6);
      }

      ctx.restore();
    }
  }

  function drawLockOnAnimation() {
    if (!state.lockOnAnimation) return;

    const anim = state.lockOnAnimation;
    anim.timer--;

    if (anim.timer <= 0) {
      state.lockOnAnimation = null;
      return;
    }

    ctx.save();
    // Laser beam from player to enemy
    ctx.strokeStyle = '#ff0055';
    ctx.shadowColor = '#ff0055';
    ctx.shadowBlur = 16;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(anim.startX, anim.startY);
    ctx.lineTo(anim.targetX, anim.targetY);
    ctx.stroke();

    // Lock-on Crosshair
    ctx.strokeStyle = '#00f3ff';
    ctx.lineWidth = 2;
    const progress = anim.timer / anim.maxTimer;
    const radius = 18 * progress;
    ctx.beginPath();
    ctx.arc(anim.targetX, anim.targetY, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.font = 'bold 9px "Share Tech Mono"';
    ctx.fillStyle = '#ff0055';
    ctx.textAlign = 'center';
    ctx.fillText('TARGET LOCKED', anim.targetX, anim.targetY - 22);

    ctx.restore();
  }

  function drawParticles() {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;

      if (p.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }

      const alpha = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
      ctx.restore();
    }
  }

  function drawFloatingTexts() {
    for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
      const ft = state.floatingTexts[i];
      ft.y -= 0.8;
      ft.life--;

      if (ft.life <= 0) {
        state.floatingTexts.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.font = 'bold 12px "Share Tech Mono"';
      ctx.fillStyle = ft.color;
      ctx.globalAlpha = Math.min(1, ft.life / 20);
      ctx.textAlign = 'center';
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  }

  function drawTargetBeacon() {
    if (state.lastTargetPoint) {
      ctx.save();
      const pt = state.lastTargetPoint;
      ctx.strokeStyle = '#00f3ff';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 4]);

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 14, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(pt.x - 20, pt.y);
      ctx.lineTo(pt.x + 20, pt.y);
      ctx.moveTo(pt.x, pt.y - 20);
      ctx.lineTo(pt.x, pt.y + 20);
      ctx.stroke();

      ctx.font = 'bold 9px "Share Tech Mono"';
      ctx.fillStyle = '#00f3ff';
      ctx.textAlign = 'center';
      ctx.fillText('INJECTION POINT', pt.x, pt.y - 18);
      ctx.restore();
    }
  }

  // --- Main Game Loop ---
  let lastTimestamp = performance.now();

  function gameLoop(timestamp) {
    const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.1);
    lastTimestamp = timestamp;

    if (!state.isGameOver && !state.levelWon) {
      player.update();
      updateEnemies(dt);
      checkHazardsAndExit();
    }

    drawBackground();
    drawTutorialSigns();
    drawPlatforms();
    drawHazards();
    drawExitPortal();
    drawEnemies();
    drawLockOnAnimation();
    player.draw(ctx);
    drawParticles();
    drawFloatingTexts();
    drawTargetBeacon();

    requestAnimationFrame(gameLoop);
  }

  // --- Input Bindings ---
  function setupInputs() {
    // Unlock Audio Context on first interaction
    const unlockAudio = () => {
      window.soundSystem.init();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio, { passive: true });

    window.addEventListener('keydown', (e) => {
      const isInputActive = document.activeElement === commandInputEl;

      if (e.key === 'Enter') {
        if (!isInputActive) {
          commandInputEl.focus();
          e.preventDefault();
          return;
        }
      }

      if (e.key === 'r' || e.key === 'R') {
        if (!isInputActive) {
          loadLevel(state.currentLevelIndex);
          return;
        }
      }

      if (isInputActive) return;

      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        state.keys.left = true;
      }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        state.keys.right = true;
      }
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === ' ') {
        state.keys.jump = true;
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        state.keys.left = false;
      }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        state.keys.right = false;
      }
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === ' ') {
        state.keys.jump = false;
      }
    });

    // Command Form Submit
    commandFormEl.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = commandInputEl.value;
      if (val) {
        executeCommand(val);
        commandInputEl.value = '';
      }
      commandInputEl.blur(); // Automatically restore WASD keys
    });

    // Command Chips
    chipButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmd = btn.getAttribute('data-cmd');
        if (cmd) {
          executeCommand(cmd);
        }
      });
    });

    // Canvas click to designate target point
    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_WIDTH / rect.width;
      const scaleY = CANVAS_HEIGHT / rect.height;
      const clickX = (e.clientX - rect.left) * scaleX;
      const clickY = (e.clientY - rect.top) * scaleY;

      state.lastTargetPoint = { x: clickX, y: clickY };
      createBurst(clickX, clickY, '#00f3ff', 8);
    });

    // Restart button
    restartBtnEl.addEventListener('click', () => {
      loadLevel(state.currentLevelIndex);
    });

    // Sound toggle button
    soundToggleBtnEl.addEventListener('click', () => {
      const isMuted = window.soundSystem.toggleMute();
      soundToggleBtnEl.textContent = isMuted ? '🔇' : '🔊';
      logFeed(isMuted ? 'AUDIO SYSTEM MUTED' : 'AUDIO SYNTHESIZER ONLINE', 'info');
    });

    // Tutorial modal open / close
    tutorialToggleBtnEl.addEventListener('click', () => {
      tutorialModalEl.classList.remove('hidden');
    });

    startGameBtnEl.addEventListener('click', () => {
      tutorialModalEl.classList.add('hidden');
      window.soundSystem.init();
    });

    // Mobile Virtual Touch buttons
    const touchLeft = document.getElementById('touch-left');
    const touchRight = document.getElementById('touch-right');
    const touchJump = document.getElementById('touch-jump');

    if (touchLeft && touchRight && touchJump) {
      const bindTouch = (elem, keyName) => {
        elem.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          state.keys[keyName] = true;
        });
        elem.addEventListener('pointerup', (e) => {
          e.preventDefault();
          state.keys[keyName] = false;
        });
        elem.addEventListener('pointercancel', (e) => {
          e.preventDefault();
          state.keys[keyName] = false;
        });
      };

      bindTouch(touchLeft, 'left');
      bindTouch(touchRight, 'right');
      bindTouch(touchJump, 'jump');
    }
  }

  // --- Initialize ---
  function initGame() {
    setupInputs();
    loadLevel(0);
    requestAnimationFrame(gameLoop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGame);
  } else {
    initGame();
  }
})();
