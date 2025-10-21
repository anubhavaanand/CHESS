/* Minimal chess engine + UI for two-player local play.
   Features: legal move generation, check detection, castling, en-passant, promotion (to queen).
   UI: click to select, click to move, move history, new game, flip board.
*/

// Unicode pieces for display
const UNICODE = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟'
};

// Board coords helpers
const files = ['a','b','c','d','e','f','g','h'];

function squareToCoord(r, c){ return files[c] + (8 - r); }
function coordToRC(coord){
  const f = files.indexOf(coord[0]);
  const r = 8 - parseInt(coord[1],10);
  return [r, f];
}

// Game state
let board = [];
let sideToMove = 'w';
let castling = { wK:true, wQ:true, bK:true, bQ:true };
let enPassant = null; // algebraic square string
let halfmoveClock = 0;
let fullmoveNumber = 1;
let moveHistory = [];
let selected = null;
let legalMovesCache = [];
let flipped = false;

// DOM
const boardEl = document.getElementById('board');
const moveListEl = document.getElementById('moveList');
const turnIndicator = document.getElementById('turnIndicator');
document.getElementById('newGameBtn').addEventListener('click', newGame);
document.getElementById('flipBtn').addEventListener('click', ()=>{ flipped = !flipped; render(); });

function newGame(){
  initBoard();
  sideToMove = 'w';
  castling = { wK:true, wQ:true, bK:true, bQ:true };
  enPassant = null;
  halfmoveClock = 0;
  fullmoveNumber = 1;
  moveHistory = [];
  selected = null;
  legalMovesCache = [];
  flipped = false;
  render();
}

function initBoard(){
  // 8x8 array null or strings like 'wP','bK'
  board = Array.from({length:8}, ()=>Array(8).fill(null));
  const backRank = ['R','N','B','Q','K','B','N','R'];
  for(let c=0;c<8;c++){ board[0][c] = 'b' + backRank[c]; board[1][c] = 'bP'; board[6][c] = 'wP'; board[7][c] = 'w' + backRank[c]; }
}

// Read helpers
function pieceAt(r,c){ return (r>=0 && r<8 && c>=0 && c<8) ? board[r][c] : null; }
function cloneBoard(b){
  return b.map(row => row.slice());
}

// Move generation
function generateAllLegalMoves(color){
  const moves = [];
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      const p = board[r][c];
      if(!p) continue;
      if(p[0] !== color) continue;
      const from = squareToCoord(r,c);
      const pseudo = generatePseudoLegalMovesForSquare(r,c);
      for(const mv of pseudo){
        // test legality
        const state = makeMoveReturnState({from, to: mv.to, promotion: mv.promotion, test:true});
        if(state && !isKingInCheck(color, state.board, state.castling, state.enPassant)){
          moves.push({from, to: mv.to, piece: p, promotion: mv.promotion});
        }
      }
    }
  }
  return moves;
}

function generatePseudoLegalMovesForSquare(r,c){
  const p = board[r][c];
  if(!p) return [];
  const color = p[0];
  const type = p[1];
  const dir = color === 'w' ? -1 : 1;
  const moves = [];

  function pushIfEmpty(rr,cc){
    if(rr<0||rr>7||cc<0||cc>7) return;
    if(!board[rr][cc]) moves.push({to: squareToCoord(rr,cc)});
  }
  function pushIfCapture(rr,cc){
    if(rr<0||rr>7||cc<0||cc>7) return;
    const q = board[rr][cc];
    if(q && q[0] !== color) moves.push({to: squareToCoord(rr,cc)});
  }

  if(type === 'P'){
    // single
    if(r + dir >=0 && r + dir <=7 && !board[r+dir][c]){
      moves.push({to:squareToCoord(r+dir,c)});
      // double
      const startRank = (color==='w'?6:1);
      if(r === startRank && !board[r + 2*dir][c]){
        moves.push({to:squareToCoord(r + 2*dir, c), doublePawn:true});
      }
    }
    // captures
    for(const dc of [-1,1]){
      const rr = r + dir, cc = c + dc;
      if(rr>=0 && rr<8 && cc>=0 && cc<8){
        const q = board[rr][cc];
        if(q && q[0] !== color) moves.push({to: squareToCoord(rr,cc), capture:true});
      }
    }
    // en-passant
    if(enPassant){
      const [er, ec] = coordToRC(enPassant);
      if(er === r + dir && Math.abs(ec - c) === 1){
        moves.push({to: enPassant, enPassant:true});
      }
    }
    // promotion handled at makeMove (if pawn reaches last rank)
  } else if(type === 'N'){
    const deltas = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    for(const [dr,dc] of deltas){
      const rr=r+dr, cc=c+dc;
      if(rr<0||rr>7||cc<0||cc>7) continue;
      const q = board[rr][cc];
      if(!q) moves.push({to:squareToCoord(rr,cc)}); else if(q[0]!==color) moves.push({to:squareToCoord(rr,cc), capture:true});
    }
  } else if(type === 'B' || type === 'R' || type === 'Q'){
    const dirs = [];
    if(type==='B' || type==='Q') dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
    if(type==='R' || type==='Q') dirs.push([-1,0],[1,0],[0,-1],[0,1]);
    for(const [dr,dc] of dirs){
      let rr=r+dr, cc=c+dc;
      while(rr>=0 && rr<8 && cc>=0 && cc<8){
        const q = board[rr][cc];
        if(!q){ moves.push({to:squareToCoord(rr,cc)}); } else {
          if(q[0]!==color) moves.push({to:squareToCoord(rr,cc), capture:true});
          break;
        }
        rr+=dr; cc+=dc;
      }
    }
  } else if(type === 'K'){
    for(let dr=-1;dr<=1;dr++){
      for(let dc=-1;dc<=1;dc++){
        if(dr===0 && dc===0) continue;
        const rr=r+dr, cc=c+dc;
        if(rr<0||rr>7||cc<0||cc>7) continue;
        const q = board[rr][cc];
        if(!q) moves.push({to:squareToCoord(rr,cc)}); else if(q[0]!==color) moves.push({to:squareToCoord(rr,cc), capture:true});
      }
    }
    // Castling (pseudo - additional checks later)
    if(color==='w' && r===7 && c===4){
      if(castling.wK && !board[7][5] && !board[7][6]) moves.push({to:'g1', castle:'K'});
      if(castling.wQ && !board[7][1] && !board[7][2] && !board[7][3]) moves.push({to:'c1', castle:'Q'});
    }
    if(color==='b' && r===0 && c===4){
      if(castling.bK && !board[0][5] && !board[0][6]) moves.push({to:'g8', castle:'K'});
      if(castling.bQ && !board[0][1] && !board[0][2] && !board[0][3]) moves.push({to:'c8', castle:'Q'});
    }
  }

  return moves;
}

// Apply move and optionally return resulting state (for testing legality)
function makeMoveReturnState(move, opts = {}){
  // move: {from: 'e2', to:'e4', promotion:'Q'}
  const fromRC = coordToRC(move.from);
  const toRC = coordToRC(move.to);
  const pr = fromRC[0], pc = fromRC[1], tr = toRC[0], tc = toRC[1];
  const piece = board[pr][pc];
  if(!piece) return null;

  const color = piece[0];
  // copy everything
  const newBoard = cloneBoard(board);
  const newCastling = {...castling};
  let newEnPassant = null;
  // handle en-passant capture
  if(move.enPassant){
    // captured pawn is on same file, behind the to-square
    const capR = pr;
    newBoard[capR][tc] = null;
  }
  // handle castling
  if(move.castle){
    if(color === 'w'){
      if(move.castle === 'K'){
        newBoard[7][6] = 'wK'; newBoard[7][4] = null;
        newBoard[7][5] = 'wR'; newBoard[7][7] = null;
      } else {
        newBoard[7][2] = 'wK'; newBoard[7][4] = null;
        newBoard[7][3] = 'wR'; newBoard[7][0] = null;
      }
    } else {
      if(move.castle === 'K'){
        newBoard[0][6] = 'bK'; newBoard[0][4] = null;
        newBoard[0][5] = 'bR'; newBoard[0][7] = null;
      } else {
        newBoard[0][2] = 'bK'; newBoard[0][4] = null;
        newBoard[0][3] = 'bR'; newBoard[0][0] = null;
      }
    }
  } else {
    // move piece normally
    newBoard[tr][tc] = newBoard[pr][pc];
    newBoard[pr][pc] = null;
    // pawn double sets enPassant
    if(piece[1] === 'P' && Math.abs(tr - pr) === 2){
      const epR = (pr + tr) / 2;
      newEnPassant = squareToCoord(epR, tc);
    }
    // promotion
    if(piece[1] === 'P'){
      if((color === 'w' && tr === 0) || (color === 'b' && tr === 7)){
        const promo = move.promotion || 'Q';
        newBoard[tr][tc] = color + promo;
      }
    }
    // If rook or king moved, clear castling rights
    if(piece[1] === 'K'){
      if(color==='w'){ newCastling.wK = false; newCastling.wQ=false; }
      else { newCastling.bK=false; newCastling.bQ=false; }
    }
    if(piece[1] === 'R'){
      if(color==='w'){
        if(pr === 7 && pc === 0) newCastling.wQ = false;
        if(pr === 7 && pc === 7) newCastling.wK = false;
      } else {
        if(pr === 0 && pc === 0) newCastling.bQ = false;
        if(pr === 0 && pc === 7) newCastling.bK = false;
      }
    }
    // capturing rook removes opponent castling rights if needed
    const captured = board[tr][tc];
    if(captured && captured[1] === 'R'){
      if(captured[0] === 'w'){
        if(tr === 7 && tc === 0) newCastling.wQ = false;
        if(tr === 7 && tc === 7) newCastling.wK = false;
      } else {
        if(tr === 0 && tc === 0) newCastling.bQ = false;
        if(tr === 0 && tc === 7) newCastling.bK = false;
      }
    }
  }

  return { board: newBoard, castling: newCastling, enPassant: newEnPassant };
}

function isKingInCheck(color, testBoard = board, testCastling = castling, testEnPassant = enPassant){
  // find king
  let kr=-1,kc=-1;
  for(let r=0;r<8;r++) for(let c=0;c<8;c++){
    const p = testBoard[r][c];
    if(p && p[0]===color && p[1]==='K'){ kr=r; kc=c; }
  }
  if(kr===-1) return true; // no king?
  // check for opponent attacks
  const opp = color === 'w' ? 'b' : 'w';
  // pawns
  const pawnDir = (opp==='w' ? -1 : 1);
  for(const dc of [-1,1]){
    const rr = kr + pawnDir, cc = kc + dc;
    if(rr>=0&&rr<8&&cc>=0&&cc<8){
      const p = testBoard[rr][cc];
      if(p && p[0]===opp && p[1]==='P') return true;
    }
  }
  // knights
  const nDeltas = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  for(const [dr,dc] of nDeltas){
    const rr=kr+dr, cc=kc+dc;
    if(rr>=0&&rr<8&&cc>=0&&cc<8){
      const p = testBoard[rr][cc];
      if(p && p[0]===opp && p[1]==='N') return true;
    }
  }
  // sliding rooks/queens
  const straightDirs = [[-1,0],[1,0],[0,-1],[0,1]];
  for(const [dr,dc] of straightDirs){
    let rr=kr+dr, cc=kc+dc;
    while(rr>=0&&rr<8&&cc>=0&&cc<8){
      const p = testBoard[rr][cc];
      if(p){
        if(p[0]===opp && (p[1]==='R' || p[1]==='Q')) return true;
        break;
      }
      rr+=dr; cc+=dc;
    }
  }
  // bishops/queens
  const diagDirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
  for(const [dr,dc] of diagDirs){
    let rr=kr+dr, cc=kc+dc;
    while(rr>=0&&rr<8&&cc>=0&&cc<8){
      const p = testBoard[rr][cc];
      if(p){
        if(p[0]===opp && (p[1]==='B' || p[1]==='Q')) return true;
        break;
      }
      rr+=dr; cc+=dc;
    }
  }
  // king adjacency
  for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
    if(dr===0 && dc===0) continue;
    const rr=kr+dr, cc=kc+dc;
    if(rr>=0&&rr<8&&cc>=0&&cc<8){
      const p = testBoard[rr][cc];
      if(p && p[0]===opp && p[1]==='K') return true;
    }
  }
  return false;
}

// Make move on actual board (assumes it's legal)
function applyMove(move){
  const fromRC = coordToRC(move.from);
  const toRC = coordToRC(move.to);
  const pr = fromRC[0], pc = fromRC[1], tr = toRC[0], tc = toRC[1];
  const piece = board[pr][pc];
  if(!piece) return false;

  // for history record
  const san = moveToSAN(move);

  // handle en-passant
  if(move.enPassant){
    const capR = pr;
    board[capR][tc] = null;
  }
  // handle castling
  if(move.castle){
    if(piece[0]==='w'){
      if(move.castle==='K'){ board[7][6] = 'wK'; board[7][5] = 'wR'; board[7][4]=null; board[7][7]=null; }
      else { board[7][2]='wK'; board[7][3]='wR'; board[7][4]=null; board[7][0]=null; }
    } else {
      if(move.castle==='K'){ board[0][6]='bK'; board[0][5]='bR'; board[0][4]=null; board[0][7]=null; }
      else { board[0][2]='bK'; board[0][3]='bR'; board[0][4]=null; board[0][0]=null; }
    }
  } else {
    // normal move
    board[tr][tc] = board[pr][pc];
    board[pr][pc] = null;
    // promotion
    if(piece[1] === 'P'){
      if((piece[0]==='w' && tr===0) || (piece[0]==='b' && tr===7)){
        board[tr][tc] = piece[0] + (move.promotion || 'Q');
      }
    }
    // update castling rights if king or rook moved or captured rook
    if(piece[1]==='K'){
      if(piece[0]==='w'){ castling.wK=false; castling.wQ=false; } else { castling.bK=false; castling.bQ=false; }
    }
    if(piece[1]==='R'){
      if(pr===7 && pc===0) castling.wQ=false;
      if(pr===7 && pc===7) castling.wK=false;
      if(pr===0 && pc===0) castling.bQ=false;
      if(pr===0 && pc===7) castling.bK=false;
    }
    const captured = move.captured;
    if(captured && captured[1]==='R'){
      if(tr===7 && tc===0) castling.wQ=false;
      if(tr===7 && tc===7) castling.wK=false;
      if(tr===0 && tc===0) castling.bQ=false;
      if(tr===0 && tc===7) castling.bK=false;
    }
  }

  // set en-passant for next player
  if(piece[1]==='P' && Math.abs(tr - pr) === 2){
    const epR = (pr + tr) / 2;
    enPassant = squareToCoord(epR, tc);
  } else {
    enPassant = null;
  }

  // update halfmove/ fullmove
  if(piece[1]==='P' || move.captured) halfmoveClock = 0; else halfmoveClock++;
  if(sideToMove === 'b') fullmoveNumber++;

  // record
  moveHistory.push({from:move.from, to:move.to, san});
  sideToMove = sideToMove === 'w' ? 'b' : 'w';
  selected = null;
  legalMovesCache = [];
  updateUI();
  return true;
}

function moveToSAN(move){
  // minimal SAN for history: piece + target (no check/mate markers)
  const p = board[coordToRC(move.from)[0]][coordToRC(move.from)[1]];
  if(!p) return `${move.from}-${move.to}`;
  const piece = p[1] === 'P' ? '' : p[1];
  let capture = '';
  if(move.enPassant) capture = 'x';
  else {
    const tgt = coordToRC(move.to);
    if(board[tgt[0]][tgt[1]]) capture = 'x';
  }
  if(move.castle){
    return move.castle === 'K' ? 'O-O' : 'O-O-O';
  }
  const promo = move.promotion ? '=' + move.promotion : '';
  return `${piece}${capture}${move.to}${promo}`;
}

// UI functions
function render(){
  boardEl.innerHTML = '';
  const coords = [];
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      coords.push([r,c]);
    }
  }
  if(flipped) coords.reverse();
  coords.forEach(([r,c], idx)=>{
    const sq = document.createElement('div');
    const displayR = flipped ? 7 - r : r;
    const displayC = flipped ? 7 - c : c;
    const light = ((r + c) % 2 === 0);
    sq.className = 'square ' + (light ? 'light' : 'dark');
    sq.dataset.r = r; sq.dataset.c = c;
    const coord = squareToCoord(r,c);
    sq.dataset.coord = coord;
    const piece = board[r][c];
    if(piece){
      const span = document.createElement('div');
      span.className = 'piece';
      span.textContent = UNICODE[piece] || piece;
      sq.appendChild(span);
    }
    sq.addEventListener('click', onSquareClick);
    boardEl.appendChild(sq);
  });
  updateUI();
}

function updateUI(){
  // highlight legal squares if selected
  document.querySelectorAll('.square').forEach(sq => sq.classList.remove('highlight'));
  if(selected){
    for(const m of legalMovesCache){
      const selSq = document.querySelector(`.square[data-coord="${m.to}"]`);
      if(selSq) selSq.classList.add('highlight');
    }
  }
  // update move list and turn
  moveListEl.innerHTML = '';
  for(let i=0;i<moveHistory.length;i+=2){
    const li = document.createElement('li');
    const white = moveHistory[i] ? moveHistory[i].san : '';
    const black = moveHistory[i+1] ? moveHistory[i+1].san : '';
    li.textContent = `${(i/2)+1}. ${white} ${black}`;
    moveListEl.appendChild(li);
  }
  turnIndicator.textContent = `Turn: ${sideToMove==='w' ? 'White' : 'Black'}`;
  // re-render pieces (to reflect board)
  const squares = Array.from(document.querySelectorAll('.square'));
  squares.forEach(sq=>{
    sq.innerHTML = '';
    const r = parseInt(sq.dataset.r,10), c = parseInt(sq.dataset.c,10);
    const piece = board[r][c];
    if(piece){
      const span = document.createElement('div');
      span.className = 'piece';
      span.textContent = UNICODE[piece] || piece;
      sq.appendChild(span);
    }
  });
}

function onSquareClick(e){
  const sq = e.currentTarget;
  const coord = sq.dataset.coord;
  const [r,c] = coordToRC(coord);
  const p = board[r][c];
  if(selected){
    // if clicked same color piece, reselect
    const selRC = coordToRC(selected);
    const selP = board[selRC[0]][selRC[1]];
    if(selP && selP[0] === sideToMove && p && p[0] === sideToMove){
      selectSquare(coord); return;
    }
    // check if clicked a legal move
    const mv = legalMovesCache.find(m => m.to === coord);
    if(mv){
      // augment move object with captured info
      const captured = board[coordToRC(mv.to)[0]][coordToRC(mv.to)[1]];
      mv.captured = captured || null;
      applyMove(mv);
      // check for check/mate
      const oppInCheck = isKingInCheck(sideToMove === 'w' ? 'b' : 'w');
      const oppMoves = generateAllLegalMoves(sideToMove === 'w' ? 'b' : 'w');
      if(oppInCheck && oppMoves.length === 0){
        alert(`${sideToMove === 'w' ? 'White' : 'Black'} wins by checkmate!`);
      } else if(!oppInCheck && oppMoves.length === 0){
        alert('Stalemate!');
      }
      return;
    }
    // otherwise deselect
    selected = null; legalMovesCache = []; updateUI(); return;
  } else {
    // select if piece belongs to sideToMove
    if(p && p[0] === sideToMove){
      selectSquare(coord);
    }
  }
}

function selectSquare(coord){
  selected = coord;
  const [r,c] = coordToRC(coord);
  const pseudo = generatePseudoLegalMovesForSquare(r,c);
  // convert pseudo to full moves (including promotions, en-passant, castling flags)
  const fullMoves = [];
  for(const mv of pseudo){
    const moveObj = { from: coord, to: mv.to };
    if(mv.castle) moveObj.castle = mv.castle;
    if(mv.enPassant) moveObj.enPassant = true;
    // detect promotion
    const [tr,tc] = coordToRC(mv.to);
    const piece = board[r][c];
    if(piece && piece[1]==='P' && ((piece[0]==='w' && tr===0) || (piece[0]==='b' && tr===7))){
      moveObj.promotion = 'Q';
    }
    fullMoves.push(moveObj);
  }
  // filter by legality
  legalMovesCache = [];
  for(const m of fullMoves){
    const state = makeMoveReturnState(m);
    if(state && !isKingInCheck(sideToMove, state.board, state.castling, state.enPassant)){
      legalMovesCache.push(m);
    }
  }
  updateUI();
}

// initialization
initBoard();
render();
