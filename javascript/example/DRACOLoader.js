// Copyright 2016 The Draco Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
'use strict';

THREE.DRACOLoader = function(manager) {
    this.manager = (manager !== undefined) ? manager :
        THREE.DefaultLoadingManager;
    this.materials = null;
    this.verbosity = 0;
    this.dracoDecoderType = {};
};


THREE.DRACOLoader.prototype = {

    constructor: THREE.DRACOLoader,

    load: function(url, onLoad, onProgress, onError) {
        const scope = this;
        const loader = new THREE.FileLoader(scope.manager);
        loader.setPath(this.path);
        loader.setResponseType('arraybuffer');
        loader.load(url, function(blob) {
            scope.decodeDracoFile(blob, onLoad);
        }, onProgress, onError);
    },

    setPath: function(value) {
        this.path = value;
    },

    setVerbosity: function(level) {
        this.verbosity = level;
    },

    setDracoDecoderType: function(dracoDecoderType) {
        this.dracoDecoderType = dracoDecoderType;
    },

    decodeDracoFile: function(rawBuffer, callback) {
      const scope = this;
      THREE.DRACOLoader.getDecoder(this.dracoDecoderType,
          function(dracoDecoder) {
            scope.decodeDracoFileInternal(rawBuffer, dracoDecoder, callback);
      });
    },

    decodeDracoFileInternal : function(rawBuffer, dracoDecoder, callback) {
      /*
       * Here is how to use Draco Javascript decoder and get the geometry.
       */
      const buffer = new dracoDecoder.DecoderBuffer();
      buffer.Init(new Int8Array(rawBuffer), rawBuffer.byteLength);
      const wrapper = new dracoDecoder.WebIDLWrapper();

      /*
       * Determine what type is this file: mesh or point cloud.
       */
      const geometryType = wrapper.GetEncodedGeometryType(buffer);
      if (geometryType == dracoDecoder.TRIANGULAR_MESH) {
        if (this.verbosity > 0) {
          console.log('Loaded a mesh.');
        }
      } else if (geometryType == dracoDecoder.POINT_CLOUD) {
        if (this.verbosity > 0) {
          console.log('Loaded a point cloud.');
        }
      } else {
        const errorMsg = 'THREE.DRACOLoader: Unknown geometry type.'
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
      callback(this.convertDracoGeometryTo3JS(dracoDecoder, wrapper,
          geometryType, buffer));
    },

		// TODO: reduce GC frequency
    constructPopBuffer(geometryBuffer) {
			console.time('constructPopBuffer');
			let norms = [];
			let uvs   = [];

      let index = geometryBuffer.index;
			let array = index.array;
			let cells = new Array(index.count / 3);

			let tmp_arr = [0, 0, 0]
      for (let fIndex = 0, i = 0; fIndex < index.count; fIndex += 3, i += 1) {
				tmp_arr[0] = array[fIndex + 0];
				tmp_arr[1] = array[fIndex + 1];
				tmp_arr[2] = array[fIndex + 2];
				cells[i] = [tmp_arr[0], tmp_arr[1], tmp_arr[2]];
      }

      const attributes = geometryBuffer.attributes;

			const position = attributes.position;
			array = attributes.position.array;
			let positions = new Array(array.length / position.itemSize);
			for (let vIndex = 0, i = 0; vIndex < array.length; vIndex += position.itemSize, i += 1) {
				tmp_arr[0] = array[vIndex + 0];
				tmp_arr[1] = array[vIndex + 1];
				tmp_arr[2] = array[vIndex + 2];
				positions[i] = [tmp_arr[0], tmp_arr[1], tmp_arr[2]];
			}

			console.timeEnd('constructPopBuffer');
      return {
				cells,
				positions
			};
    },

    convertDracoGeometryTo3JS: function(dracoDecoder, wrapper, geometryType,
                                        buffer) {
        let dracoGeometry;
        const start_time = performance.now();
        if (geometryType == dracoDecoder.TRIANGULAR_MESH) {
          dracoGeometry = wrapper.DecodeMeshFromBuffer(buffer);
        } else {
          dracoGeometry = wrapper.DecodePointCloudFromBuffer(buffer);
        }
        const decode_end = performance.now();
        dracoDecoder.destroy(buffer);
        /*
         * Example on how to retrieve mesh and attributes.
         */
        let numFaces, numPoints;
        let numVertexCoordinates, numTextureCoordinates, numColorCoordinates;
        let numAttributes;
        let numColorCoordinateComponents = 3;
        // For output basic geometry information.
        let geometryInfoStr;
        if (geometryType == dracoDecoder.TRIANGULAR_MESH) {
          numFaces = dracoGeometry.num_faces();
          if (this.verbosity > 0) {
            console.log('Number of faces loaded: ' + numFaces.toString());
          }
        } else {
          numFaces = 0;
        }
        numPoints = dracoGeometry.num_points();
        numVertexCoordinates = numPoints * 3;
        numTextureCoordinates = numPoints * 2;
        numColorCoordinates = numPoints * 3;
        numAttributes = dracoGeometry.num_attributes();
        if (this.verbosity > 0) {
          console.log('Number of points loaded: ' + numPoints.toString());
          console.log('Number of attributes loaded: ' +
              numAttributes.toString());
        }

        // Get position attribute. Must exists.
        const posAttId = wrapper.GetAttributeId(dracoGeometry,
                                                dracoDecoder.POSITION);
        if (posAttId == -1) {
          const errorMsg = 'THREE.DRACOLoader: No position attribute found.';
          console.error(errorMsg);
          dracoDecoder.destroy(wrapper);
          dracoDecoder.destroy(dracoGeometry);
          throw new Error(errorMsg);
        }
        const posAttribute = wrapper.GetAttribute(dracoGeometry, posAttId);
        const posAttributeData = new dracoDecoder.DracoFloat32Array();
        wrapper.GetAttributeFloatForAllPoints(
            dracoGeometry, posAttribute, posAttributeData);
        // Get color attributes if exists.
        const colorAttId = wrapper.GetAttributeId(dracoGeometry,
                                                  dracoDecoder.COLOR);
        let colAttributeData;
        if (colorAttId != -1) {
          if (this.verbosity > 0) {
            console.log('Loaded color attribute.');
          }
          const colAttribute = wrapper.GetAttribute(dracoGeometry, colorAttId);
          if (colAttribute.components_count() === 4) {
            numColorCoordinates = numPoints * 4;
            numColorCoordinateComponents = 4;
          }
          colAttributeData = new dracoDecoder.DracoFloat32Array();
          wrapper.GetAttributeFloatForAllPoints(dracoGeometry, colAttribute,
                                                colAttributeData);
        }

        // Get normal attributes if exists.
        const normalAttId =
            wrapper.GetAttributeId(dracoGeometry, dracoDecoder.NORMAL);
        let norAttributeData;
        if (normalAttId != -1) {
          if (this.verbosity > 0) {
            console.log('Loaded normal attribute.');
          }
          const norAttribute = wrapper.GetAttribute(dracoGeometry, normalAttId);
          norAttributeData = new dracoDecoder.DracoFloat32Array();
          wrapper.GetAttributeFloatForAllPoints(dracoGeometry, norAttribute,
                                                norAttributeData);
        }

        // Get texture coord attributes if exists.
        const texCoordAttId =
            wrapper.GetAttributeId(dracoGeometry, dracoDecoder.TEX_COORD);
        let textCoordAttributeData;
        if (texCoordAttId != -1) {
          if (this.verbosity > 0) {
            console.log('Loaded texture coordinate attribute.');
          }
          const texCoordAttribute = wrapper.GetAttribute(dracoGeometry,
                                                         texCoordAttId);
          textCoordAttributeData = new dracoDecoder.DracoFloat32Array();
          wrapper.GetAttributeFloatForAllPoints(dracoGeometry,
                                                texCoordAttribute,
                                                textCoordAttributeData);
        }

        // Structure for converting to THREEJS geometry later.
        const numIndices = numFaces * 3;
        const geometryBuffer = {
            indices: new Uint32Array(numIndices),
            vertices: new Float32Array(numVertexCoordinates),
            normals: new Float32Array(numVertexCoordinates),
            uvs: new Float32Array(numTextureCoordinates),
            colors: new Float32Array(numColorCoordinates)
        };

        for (let i = 0; i < numVertexCoordinates; i += 3) {
            geometryBuffer.vertices[i] = posAttributeData.GetValue(i);
            geometryBuffer.vertices[i + 1] = posAttributeData.GetValue(i + 1);
            geometryBuffer.vertices[i + 2] = posAttributeData.GetValue(i + 2);
            // Add normal.
            if (normalAttId != -1) {
              geometryBuffer.normals[i] = norAttributeData.GetValue(i);
              geometryBuffer.normals[i + 1] = norAttributeData.GetValue(i + 1);
              geometryBuffer.normals[i + 2] = norAttributeData.GetValue(i + 2);
            }
        }

        // Add color.
        for (let i = 0; i < numColorCoordinates; i += 1) {
          if (colorAttId != -1) {
            // Draco colors are already normalized.
            geometryBuffer.colors[i] = colAttributeData.GetValue(i);
          } else {
            // Default is white. This is faster than TypedArray.fill().
            geometryBuffer.colors[i] = 1.0;
          }
        }

        // Add texture coordinates.
        if (texCoordAttId != -1) {
          for (let i = 0; i < numTextureCoordinates; i += 2) {
            geometryBuffer.uvs[i] = textCoordAttributeData.GetValue(i);
            geometryBuffer.uvs[i + 1] = textCoordAttributeData.GetValue(i + 1);
          }
        }

        dracoDecoder.destroy(posAttributeData);
        if (colorAttId != -1)
          dracoDecoder.destroy(colAttributeData);
        if (normalAttId != -1)
          dracoDecoder.destroy(norAttributeData);
        if (texCoordAttId != -1)
          dracoDecoder.destroy(textCoordAttributeData);

        // For mesh, we need to generate the faces.
        if (geometryType == dracoDecoder.TRIANGULAR_MESH) {
          const ia = new dracoDecoder.DracoInt32Array();
          for (let i = 0; i < numFaces; ++i) {
            wrapper.GetFaceFromMesh(dracoGeometry, i, ia);
            const index = i * 3;
            geometryBuffer.indices[index] = ia.GetValue(0);
            geometryBuffer.indices[index + 1] = ia.GetValue(1);
            geometryBuffer.indices[index + 2] = ia.GetValue(2);
          }
          dracoDecoder.destroy(ia);
        }
        dracoDecoder.destroy(wrapper);
        dracoDecoder.destroy(dracoGeometry);

        // Import data to Three JS geometry.
        const geometry = new THREE.BufferGeometry();
        if (geometryType == dracoDecoder.TRIANGULAR_MESH) {
          geometry.setIndex(new(geometryBuffer.indices.length > 65535 ?
                THREE.Uint32BufferAttribute : THREE.Uint16BufferAttribute)
              (geometryBuffer.indices, 1));
        }
        geometry.addAttribute('position',
            new THREE.Float32BufferAttribute(geometryBuffer.vertices, 3));
        geometry.addAttribute('color',
            new THREE.Float32BufferAttribute(geometryBuffer.colors,
                                             numColorCoordinateComponents));
        if (normalAttId != -1) {
          geometry.addAttribute('normal',
              new THREE.Float32BufferAttribute(geometryBuffer.normals, 3));
        }
        if (texCoordAttId != -1) {
          geometry.addAttribute('uv',
              new THREE.Float32BufferAttribute(geometryBuffer.uvs, 2));
        }

        // TODO(xuanfeng): construct LOD of pop-buffer information (solve the performance issue)
        const popbuffer_start = performance.now();
        const pbInfo = this.constructPopBuffer(geometry);
				if (window.pb) {
					const buf = pb.encode(pbInfo.cells, pbInfo.positions, 16);
					console.log(buf);
				}

        this.decode_time = decode_end - start_time;
        this.import_time = popbuffer_start - decode_end;
        this.encode_pop_buffer_time = performance.now() - popbuffer_start;

        if (this.verbosity > 0) {
          console.log('Decode time: ' + this.decode_time);
          console.log('Import time: ' + this.import_time);
          console.log('Popbuffer time: ' + this.encode_pop_buffer_time);
        }
        return geometry;
    },

    isVersionSupported: function(version, callback) {
        return THREE.DRACOLoader.getDecoder(this.dracoDecoderType,
            function(decoder) { return decoder.isVersionSupported(version); });
    }
};

/**
 * Creates and returns a singleton instance of the DracoModule decoder.
 * The module loading is done asynchronously for WebAssembly. Initialized module
 * can be accessed through the callback function |onDracoModuleLoadedCallback|.
 */
THREE.DRACOLoader.getDecoder = (function() {
    let decoder;

    return function(dracoDecoderType, onDracoModuleLoadedCallback) {
        if (typeof DracoModule === 'undefined') {
          throw new Error('THREE.DRACOLoader: DracoModule not found.');
        }
        if (typeof decoder !== 'undefined') {
          // Module already initialized.
          if (typeof onDracoModuleLoadedCallback !== 'undefined') {
            onDracoModuleLoadedCallback(decoder);
          }
        } else {
          dracoDecoderType['onModuleLoaded'] = function(module) {
            if (typeof onDracoModuleLoadedCallback === 'function') {
              decoder = module;
              onDracoModuleLoadedCallback(module);
            }
          };
          DracoModule(dracoDecoderType);
        }
    };

})();
