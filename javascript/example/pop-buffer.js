/*
 * TODO
 * - crack prevention
 * - vertex attributes
 */
function computeBoundingBox(positions) {
  if(positions.length === 0) {
    return null;
  }

  var dimensions = positions[0].length;
  var min = new Array(dimensions);
  var max = new Array(dimensions);

  for(var i=0; i<dimensions; i++) {
    min[i] =  Infinity;
    max[i] = -Infinity;
  }

  for (let index = 0; index < positions.length; index++) {
    let position = positions[index];
    for(var i=0; i<dimensions; i++) {
      max[i] = position[i] > max[i] ? position[i] : max[i];
      min[i] = position[i] < min[i] ? position[i] : min[i];
    }
  }

  return [min, max];
}
function roundVertices(positions) {
  // reduce GC, so abort the map method
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < 3; j++) {
      positions[i][j] = positions[i][j] | 0;
    }
  }
  return positions;

  return positions.map(function(position) {
    return position.map(function(value) {
      //return parseInt(value);
      return value | 0;
    });
  });
}

function quantizeVertices(positions, bits, sourceBounds) {
  if(positions.length === 0) {
    return [];
  }

  var dimensions = positions[0].length;
  var bounds = [
    new Array(dimensions),
    new Array(dimensions)
  ];

  for(var i=0; i<dimensions; i++) {
    bounds[0][i] = 0;
    bounds[1][i] = (typeof bits === 'number')
      ? (1 << bits) - 1
      : (1 << bits[i]) - 1
  }

  positions = rescaleVertices(positions, bounds, sourceBounds);
  positions = roundVertices(positions);
  return positions;
}

function rescaleVertices(positions, targetBounds, sourceBounds) {

  sourceBounds = sourceBounds || computeBoundingBox(positions);

  var dimensions = positions[0].length;
  var sourceSpans = new Array(dimensions);
  var targetSpans = new Array(dimensions);

  for(var i=0; i<dimensions; i++) {
    sourceSpans[i] = sourceBounds[1][i] - sourceBounds[0][i];
    targetSpans[i] = targetBounds[1][i] - targetBounds[0][i];
  }


  // for (let i = 0; i < positions.length; i++) {
  //   let position = positions[i];
  //   for (let j = 0; j < dimensions; j++) {
  //     positions[i][j] = (position[j] - sourceBounds[0][j]) / sourceSpans[j] * targetSpans[j] + targetBounds[0][j];
  //   }
  // }
  // return positions;

  return positions.map(function(position) {
    var rescaled = new Array(dimensions);
    for(var i=0; i<dimensions; i++) {
      rescaled[i] = (position[i] - sourceBounds[0][i]) / sourceSpans[i] * targetSpans[i] + targetBounds[0][i];
    }
    return rescaled;
  });
}

function encode(cells, positions, maxLevel) {
  var boundingBox = computeBoundingBox(positions);

  // var buckets = buildBuckets(cells, positions, maxLevel);
  var buckets = buildNewBuckets(cells, positions, maxLevel);
  var levels = buildLevels(buckets, positions);

  return {
    bounds: boundingBox,
    levels: levels
  };
}

function decode(pb) {
  var cells = [];
  var positions = [];

  var levels = pb.levels;
  var bounds = pb.bounds;

  for (var i = 0; i < levels.length; i++) {
    cells = cells.concat(levels[i].cells);
    positions = positions.concat(levels[i].positions);
  }

  if (cells.length !== 0 && positions.length !== 0) {
    var level = levels.length;
    positions = quantizeVertices(positions, level, bounds);
    positions = rescaleVertices(positions, bounds);
  }

  return {
    cells: cells,
    positions: positions
  };
}


function buildLevels(buckets, positions) {
  var indexLookup = {};
  var lastIndex = 0;
  var levels = new Array(buckets.length);

  /*
   * Reindex positions, putting them in the level where they first appear
   */
  // 遍历每一层，处理这一层的各面片信息
  // 对顶点下标重新编排，level 越粗糙的面片，对应的顶点下标越靠前
  for (var i = 0; i < buckets.length; i++) {
    var cells = buckets[i];
    var level = {
      cells: new Array(cells.length),
      positions: []
    };
    // 遍历第 i 层对应的各三角面片 cells
    for (var j = 0; j < cells.length; j++) {
      var cell = cells[j];
      var newCell = new Array(cell.length);

      for (var k = 0; k < cell.length; k++) {
        // 这个 index 是一个面片中顶点的索引
        var index = cell[k];

        if (indexLookup[index] === undefined) {
          level.positions.push(positions[index]);
          indexLookup[index] = lastIndex;
          lastIndex++;
        }

        newCell[k] = indexLookup[index];
      }

      level.cells[j] = newCell;
    }

    levels[i] = level;
  }

  return levels;
}

// 最终返回的是分层的面片信息
// TODO: speedup this
function buildBuckets(cells, positions, maxLevel) {
  var cellLevels = new Array(cells.length);

  /*
   * Cells that still have level -1 at the end of the process will never pop, ie. they will be
   * degenerate even at the highest quantization level.
   */
  for (var i = 0; i < cells.length; i++) {
    cellLevels[i] = -1;
  }

  const boundingBox = computeBoundingBox(positions);

  /*
   * Go from the maximum quantization level down to 1 and update the pop level
   * of each cell that is still not degenerate at this quantization level.
   */
  for (var level = maxLevel; level > 0; level--) {

    // Quantize the positions at "level" bits precision
    var quantizedPositions = quantizeVertices(positions, level, boundingBox);
    // console.log(level, quantizedPositions[0])
    // Extract the indices of non-degenerate cells at this level
    var cellIndices = listNonDegenerateCells(cells, quantizedPositions);

    // Update the pop level for the set of cells that are still not degenerate
    for (var i = 0; i < cellIndices.length; i++) {
      cellLevels[cellIndices[i]] = level;
    }
  }

  var buckets = new Array(maxLevel);

  // Initialize each bucket to an empty array
  for (var i = 0; i < maxLevel; i++) {
    buckets[i] = [];
  }

  /*
   * Finally, put each cell into its pop level bucket,
   * ignoring never-popping cells
   */
  for (var i = 0; i < cellLevels.length; i++) {
    if (i < 30) {
      // console.log(i, cellLevels[i]);
    }
    var cellLevel = cellLevels[i];
    if (cellLevel === -1) {
      continue;
    }
    buckets[cellLevel - 1].push(cells[i]);
  }
  return buckets;
}

// BUG: different to the buildBuckets method
function buildNewBuckets(cells, positions, maxLevel) {
  function getLevel(v1, v2) {
    let level = 0;
    while (level < maxLevel) {
        if (v1 !== v2) {
          v1 = v1 >> 1; v2 = v2 >> 1;
          level += 1;
        } else {
          break;
        }
    }
    return level;
  }

  function getVLevel(p, q) {
    return Math.max(getLevel(p[0], q[0]), getLevel(p[1], q[1]), getLevel(p[2], q[2]));
  }

  function getTLevel(A, B, C) {
    return Math.min(getVLevel(A, B), getVLevel(B, C), getVLevel(A, C))
  }
  
  const boundingBox = computeBoundingBox(positions);
  const quantizedPositions = quantizeVertices(positions, maxLevel, boundingBox);

  var buckets = new Array(maxLevel);

  // Initialize each bucket to an empty array
  for (var i = 0; i < maxLevel; i++) {
    buckets[i] = [];
  }
  for (var i = 0; i < cells.length; i++) {
    var f = cells[i];
    var level = getTLevel(quantizedPositions[f[0]], quantizedPositions[f[1]], quantizedPositions[f[2]])
    level = maxLevel - level;
    if (level >= maxLevel || level < 0) {
      continue;
    }
    if (i < 30) {
      // console.log(i, level);
    }
    buckets[level].push(cells[i]);
  }

  return buckets;
}


function extractCells(cells, indices) {
  var extracted = new Array(indices.length);
  for (var i = 0; i < indices.length; i++) {
    extracted[i] = cells[indices[i]];
  }
  return extracted;
}


function listNonDegenerateCells(cells, positions) {
  var nonDegenerateCells = [];

  for (var i = 0; i < cells.length; i++) {
    // 只要三角面片上有任意两个点落到了同一区间，即返回 true
    var degenerate = isTriangleDegenerate([
      positions[cells[i][0]],
      positions[cells[i][1]],
      positions[cells[i][2]],
    ]);

    if (!degenerate) {
      nonDegenerateCells.push(i);
    }
  }

  return nonDegenerateCells;
}


function isTriangleDegenerate(tri) {
  return arrayEqual(tri[0], tri[1]) || arrayEqual(tri[1], tri[2]) || arrayEqual(tri[2], tri[0]);
}


function arrayEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

if (typeof window !== 'undefined') {
  window.pb = {
    encode, decode
  }
} else {
  module.exports = {
    encode: encode,
    decode: decode
  };
}

if (false) {
  var bunny = require('./bunny');
  var cells = bunny.cells; 
  var positions = bunny.positions;
  var maxLevel = 16;
  var buckets = buildBuckets(cells, positions, maxLevel);
  var newBuckets = buildNewBuckets(cells, positions, maxLevel);
}
