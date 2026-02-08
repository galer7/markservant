// @ts-nocheck
// player.js — Runs inside the VS Code webview (browser context).
// Handles audio playback, rAF-based word timing, and postMessage
// communication with the extension host.

(() => {
  // ---------------------------------------------------------------------------
  // VS Code API
  // ---------------------------------------------------------------------------

  /** @type {ReturnType<typeof acquireVsCodeApi>} */
  var vscode = acquireVsCodeApi();

  // ---------------------------------------------------------------------------
  // DOM references (IDs match playerHtml.ts)
  // ---------------------------------------------------------------------------

  /** @type {HTMLAudioElement} */
  var audio = document.getElementById("audio-player");
  /** @type {HTMLButtonElement} */
  var btnPlayPause = document.getElementById("play-pause-btn");
  /** @type {HTMLButtonElement} */
  var btnStop = document.getElementById("stop-btn");
  /** @type {HTMLElement} */
  var statusEl = document.getElementById("status");
  /** @type {HTMLElement} */
  var currentChunkEl = document.getElementById("current-chunk");
  /** @type {HTMLElement} */
  var totalChunksEl = document.getElementById("total-chunks");
  /** @type {HTMLElement} */
  var iconPlay = document.getElementById("icon-play");
  /** @type {HTMLElement} */
  var iconPause = document.getElementById("icon-pause");
  /** @type {HTMLElement} */
  var synthProgressEl = document.getElementById("synth-progress");
  /** @type {HTMLElement} */
  var synthProgressFill = document.getElementById("synth-progress-fill");
  /** @type {HTMLElement} */
  var synthProgressLabel = document.getElementById("synth-progress-label");
  /** @type {HTMLElement} */
  var synthEstimate = document.getElementById("synth-estimate");
  /** @type {HTMLInputElement} */
  var speedSlider = document.getElementById("speed-slider");
  /** @type {HTMLElement} */
  var speedValue = document.getElementById("speed-value");

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** @type {Array<{word: string, start_time: number, end_time: number}>} */
  var timestamps = [];

  /** Index of the chunk currently loaded into the audio element. */
  var currentChunkIndex = -1;

  /** Total number of chunks in the document. */
  var _totalChunks = 0;

  /** Index of the last word we reported to the extension host. -1 = none. */
  var lastHighlightedIndex = -1;

  /** ID returned by requestAnimationFrame so we can cancel the loop. */
  var rafId = 0;

  /**
   * Whether the user has interacted (clicked play) at least once.
   * Browsers (and VS Code webviews) block programmatic audio.play()
   * until after a user gesture. After the first click-initiated play,
   * subsequent programmatic plays (e.g. chunk transitions) are allowed.
   */
  var userHasInteracted = false;

  /**
   * Whether we are currently playing (or intending to play).
   * This is our logical state — audio.paused may differ briefly during
   * async play() calls.
   */
  var isPlaying = false;

  /**
   * Flag that indicates we just finished a chunk and are waiting for the
   * extension host to load the next one. Prevents the 'ended' handler
   * from firing multiple times.
   */
  var awaitingNextChunk = false;

  /** Playback rate multiplier (1.0 = normal). Set by extension host. */
  var playbackRate = 1.0;

  /** Whether all chunks have been synthesized. */
  var synthDone = false;

  // ---------------------------------------------------------------------------
  // Binary search: find the word index whose time range contains `time`
  // ---------------------------------------------------------------------------

  /**
   * @param {Array<{start_time: number, end_time: number}>} ts
   * @param {number} time
   * @returns {number} index into ts, or -1 if no word spans this time
   */
  function findWordAtTime(ts, time) {
    var low = 0;
    var high = ts.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (time < ts[mid].start_time) {
        high = mid - 1;
      } else if (time > ts[mid].end_time) {
        low = mid + 1;
      } else {
        return mid;
      }
    }
    return -1;
  }

  // ---------------------------------------------------------------------------
  // requestAnimationFrame timing loop
  // ---------------------------------------------------------------------------

  function startTimingLoop() {
    // Avoid starting duplicate loops
    if (rafId) {
      return;
    }

    function tick() {
      if (audio.paused || audio.ended) {
        rafId = 0;
        return;
      }

      if (timestamps.length > 0) {
        const idx = findWordAtTime(timestamps, audio.currentTime);
        if (idx !== -1 && idx !== lastHighlightedIndex) {
          lastHighlightedIndex = idx;
          vscode.postMessage({ type: "highlightWord", index: idx });
        }
      }

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
  }

  function stopTimingLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------------------

  function updatePlayPauseButton() {
    if (isPlaying) {
      if (iconPlay) iconPlay.style.display = "none";
      if (iconPause) iconPause.style.display = "";
      btnPlayPause.setAttribute("aria-label", "Pause");
      btnPlayPause.setAttribute("title", "Pause");
    } else {
      if (iconPlay) iconPlay.style.display = "";
      if (iconPause) iconPause.style.display = "none";
      btnPlayPause.setAttribute("aria-label", "Play");
      btnPlayPause.setAttribute("title", "Play");
    }
  }

  /**
   * @param {string} text
   */
  function setStatus(text) {
    if (statusEl) {
      statusEl.textContent = text;
    }
  }

  /**
   * @param {number} current
   * @param {number} total
   */
  function setProgress(current, total) {
    if (currentChunkEl) currentChunkEl.textContent = String(current);
    if (totalChunksEl) totalChunksEl.textContent = String(total);
  }

  function enableButtons() {
    btnPlayPause.disabled = false;
    btnStop.disabled = false;
  }

  function disableButtons() {
    btnPlayPause.disabled = true;
    btnStop.disabled = true;
  }

  function showSynthProgress(current, total, avgMs, remainingMs) {
    var avgSec = (avgMs / 1000).toFixed(1);
    var remainSec = Math.round(remainingMs / 1000);

    if (synthProgressEl) synthProgressEl.style.display = "";
    if (synthProgressFill) {
      synthProgressFill.style.width = `${Math.round((current / total) * 100)}%`;
    }
    if (synthProgressLabel) {
      synthProgressLabel.textContent = `Synthesizing ${current} / ${total}`;
    }
    if (synthEstimate) {
      synthEstimate.textContent =
        remainingMs > 0 ? `~${avgSec}s/chunk \u00B7 ~${remainSec}s left` : "Done";
    }
  }

  function hideSynthProgress() {
    if (synthProgressEl) synthProgressEl.style.display = "none";
  }

  function updateBufferDisplay() {
    setProgress(currentChunkIndex + 1, _totalChunks);
  }

  // ---------------------------------------------------------------------------
  // Playback control
  // ---------------------------------------------------------------------------

  /**
   * Attempt to play the audio element. Handles the Promise returned by
   * audio.play() and catches autoplay-policy rejections gracefully.
   */
  function doPlay() {
    isPlaying = true;
    updatePlayPauseButton();
    setStatus("Playing");

    audio.playbackRate = playbackRate;
    var playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          userHasInteracted = true;
          startTimingLoop();
          vscode.postMessage({ type: "playbackStarted" });
        })
        .catch((err) => {
          // Autoplay was blocked — user needs to click the Play button.
          isPlaying = false;
          updatePlayPauseButton();
          if (err.name === "NotAllowedError") {
            setStatus("Click Play to start");
          } else {
            setStatus("Playback error");
            vscode.postMessage({
              type: "error",
              message: `Audio playback failed: ${err.message}`,
            });
          }
        });
    }
  }

  function doPause() {
    isPlaying = false;
    audio.pause();
    stopTimingLoop();
    updatePlayPauseButton();
    setStatus("Paused");
    vscode.postMessage({ type: "playbackPaused" });
  }

  function doStop() {
    isPlaying = false;
    awaitingNextChunk = false;
    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute("src");
    audio.load(); // Reset the audio element fully
    stopTimingLoop();
    timestamps = [];
    lastHighlightedIndex = -1;
    currentChunkIndex = -1;
    _totalChunks = 0;
    synthDone = false;
    hideSynthProgress();
    updatePlayPauseButton();
    disableButtons();
    setStatus("Stopped");
    setProgress(0, 0);
    vscode.postMessage({ type: "playbackStopped" });
  }

  // ---------------------------------------------------------------------------
  // Audio element event handlers
  // ---------------------------------------------------------------------------

  audio.addEventListener("ended", () => {
    if (awaitingNextChunk) {
      return; // Already handled
    }

    stopTimingLoop();

    // Highlight the last word if we haven't already
    if (timestamps.length > 0 && lastHighlightedIndex !== timestamps.length - 1) {
      lastHighlightedIndex = timestamps.length - 1;
      vscode.postMessage({ type: "highlightWord", index: lastHighlightedIndex });
    }

    awaitingNextChunk = true;

    // Tell extension host this chunk is done — it will either send
    // loadAudio for the next chunk or send stop.
    vscode.postMessage({ type: "chunkEnded", chunkIndex: currentChunkIndex });
  });

  audio.addEventListener("error", () => {
    var mediaError = audio.error;
    var msg = "Audio error";
    if (mediaError) {
      switch (mediaError.code) {
        case MediaError.MEDIA_ERR_ABORTED:
          msg = "Audio playback aborted";
          break;
        case MediaError.MEDIA_ERR_NETWORK:
          msg = "Network error during audio playback";
          break;
        case MediaError.MEDIA_ERR_DECODE:
          msg = "Audio decoding error";
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          msg = "Audio format not supported";
          break;
      }
    }
    isPlaying = false;
    stopTimingLoop();
    updatePlayPauseButton();
    setStatus(msg);
    vscode.postMessage({ type: "error", message: msg });
  });

  // ---------------------------------------------------------------------------
  // Button event handlers
  // ---------------------------------------------------------------------------

  btnPlayPause.addEventListener("click", () => {
    if (!audio.src && currentChunkIndex === -1) {
      // No audio loaded yet — nothing to play
      return;
    }

    if (isPlaying) {
      doPause();
    } else {
      doPlay();
    }
  });

  btnStop.addEventListener("click", () => {
    doStop();
  });

  // ---------------------------------------------------------------------------
  // Speed slider
  // ---------------------------------------------------------------------------

  speedSlider.addEventListener("input", function () {
    var rate = parseFloat(speedSlider.value);
    playbackRate = rate;
    audio.playbackRate = rate;
    audio.defaultPlaybackRate = rate;
    speedValue.textContent = rate + "x";
    vscode.postMessage({ type: "playbackRateChanged", rate: rate });
  });

  // ---------------------------------------------------------------------------
  // Messages from extension host
  // ---------------------------------------------------------------------------

  window.addEventListener("message", (event) => {
    var msg = event.data;

    switch (msg.type) {
      case "loadAudio":
        // Load a new chunk of audio
        awaitingNextChunk = false;
        lastHighlightedIndex = -1;
        timestamps = [];
        currentChunkIndex = msg.chunkIndex;
        _totalChunks = msg.totalChunks;

        audio.src = `data:audio/mp3;base64,${msg.audioBase64}`;
        audio.load();

        enableButtons();
        setProgress(msg.chunkIndex + 1, msg.totalChunks);
        if (!synthDone) {
          setStatus("Playing \u00B7 synthesizing remaining chunks...");
        } else {
          setStatus("Loading audio...");
        }
        updateBufferDisplay();

        // Auto-play if the user has already interacted (chunk transition)
        if (userHasInteracted && isPlaying) {
          audio.addEventListener(
            "canplaythrough",
            function onCanPlay() {
              audio.removeEventListener("canplaythrough", onCanPlay);
              doPlay();
            },
            { once: true },
          );
        } else {
          setStatus("Ready — click Play to start");
        }
        break;

      case "play":
        doPlay();
        break;

      case "pause":
        doPause();
        break;

      case "stop":
        doStop();
        break;

      case "setTimestamps":
        timestamps = msg.timestamps || [];
        lastHighlightedIndex = -1;
        break;

      case "loading":
        setStatus(msg.message || "Loading...");
        break;

      case "setPlaybackRate":
        playbackRate = msg.rate || 1.0;
        audio.playbackRate = playbackRate;
        audio.defaultPlaybackRate = playbackRate;
        if (speedSlider) speedSlider.value = playbackRate;
        if (speedValue) speedValue.textContent = playbackRate + "x";
        break;

      case "synthProgress":
        showSynthProgress(msg.current, msg.total, msg.avgMs, msg.remainingMs);
        break;

      case "synthComplete":
        synthDone = true;
        hideSynthProgress();
        break;

      default:
        break;
    }
  });

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  updatePlayPauseButton();
  setStatus("Initializing...");
  setProgress(0, 0);

  // Notify the extension host that the webview is ready to receive messages.
  vscode.postMessage({ type: "ready" });
  setStatus("Ready");
})();
