// @ts-nocheck
/* eslint-disable */
// GENERATED FILE — do not edit. Precompiled ajv validators (no runtime
// code generation: MV3-safe). Source of truth: spec/schemas/*.json.
// Regenerate with: pnpm sync:schemas
import __ucs2lengthModule from 'ajv/dist/runtime/ucs2length.js';
import __formatsModule from 'ajv-formats/dist/formats.js';
// CJS/ESM interop differs between Node, vitest and bundlers: normalize.
const __ucs2length = {
  default:
    typeof __ucs2lengthModule === 'function' ? __ucs2lengthModule : __ucs2lengthModule.default,
};
const __formats = {
  fullFormats: __formatsModule.fullFormats ?? __formatsModule.default.fullFormats,
};
('use strict');
export const validateManifest = validate20;
const schema31 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wdf.dev/schemas/0.1/manifest.schema.json',
  title: 'WDF Core 0.1 — manifest.json',
  description: 'Package manifest, at the root of every .wdf archive (WDF Core 0.1 §manifest).',
  type: 'object',
  additionalProperties: false,
  required: ['wdf', 'id', 'title', 'language', 'created', 'modified', 'entry'],
  properties: {
    wdf: { description: 'Version of the WDF Core spec the package conforms to.', const: '0.1' },
    id: {
      description:
        'Stable document identifier (URN UUID). Used as the authority part of wdf: citation URIs.',
      type: 'string',
      pattern: '^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    },
    title: { type: 'string', minLength: 1 },
    language: {
      description: 'Primary language of the document (BCP 47).',
      type: 'string',
      pattern: '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$',
    },
    authors: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          role: { type: 'string', minLength: 1 },
        },
      },
    },
    created: { type: 'string', format: 'date-time' },
    modified: { type: 'string', format: 'date-time' },
    entry: { description: 'Entry document. Fixed in WDF Core 0.1.', const: 'content/index.html' },
    resources: {
      description:
        'Every package resource other than the required files. Paths are package-relative; path segments start with an alphanumeric character (no dotfiles, no traversal).',
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'mediaType'],
        properties: {
          path: { type: 'string', pattern: '^(content|data)(/[A-Za-z0-9][A-Za-z0-9._-]*)+$' },
          mediaType: { type: 'string', pattern: '^[a-z]+/[A-Za-z0-9.+-]+$' },
        },
      },
    },
    datasets: {
      description: 'Typed datasets under data/, referenced by tables via data-wdf-dataset.',
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'schema'],
        properties: {
          path: { type: 'string', pattern: '^data(/[A-Za-z0-9][A-Za-z0-9._-]*)+\\.json$' },
          title: { type: 'string', minLength: 1 },
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['columns'],
            properties: {
              columns: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['name', 'type'],
                  properties: {
                    name: { type: 'string', minLength: 1 },
                    type: { enum: ['string', 'integer', 'number', 'boolean', 'date'] },
                  },
                },
              },
            },
          },
        },
      },
    },
    extensions: {
      description:
        'Versioned extensions used by this document. Empty in WDF Core 0.1; extension content is outside the core spec.',
      type: 'array',
      items: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          version: { type: 'string', minLength: 1 },
        },
      },
    },
  },
};
const func1 = Object.prototype.hasOwnProperty;
const func2 = __ucs2length.default;
const pattern4 = new RegExp(
  '^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  'u',
);
const pattern5 = new RegExp('^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$', 'u');
const pattern6 = new RegExp('^(content|data)(/[A-Za-z0-9][A-Za-z0-9._-]*)+$', 'u');
const pattern7 = new RegExp('^[a-z]+/[A-Za-z0-9.+-]+$', 'u');
const pattern8 = new RegExp('^data(/[A-Za-z0-9][A-Za-z0-9._-]*)+\\.json$', 'u');
const formats0 = __formats.fullFormats['date-time'];
function validate20(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  /*# sourceURL="https://wdf.dev/schemas/0.1/manifest.schema.json" */ let vErrors = null;
  let errors = 0;
  const evaluated0 = validate20.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.wdf === undefined) {
      const err0 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'wdf' },
        message: "must have required property '" + 'wdf' + "'",
      };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.id === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'id' },
        message: "must have required property '" + 'id' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.title === undefined) {
      const err2 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'title' },
        message: "must have required property '" + 'title' + "'",
      };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.language === undefined) {
      const err3 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'language' },
        message: "must have required property '" + 'language' + "'",
      };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.created === undefined) {
      const err4 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'created' },
        message: "must have required property '" + 'created' + "'",
      };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.modified === undefined) {
      const err5 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'modified' },
        message: "must have required property '" + 'modified' + "'",
      };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.entry === undefined) {
      const err6 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'entry' },
        message: "must have required property '" + 'entry' + "'",
      };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func1.call(schema31.properties, key0)) {
        const err7 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.wdf !== undefined) {
      if ('0.1' !== data.wdf) {
        const err8 = {
          instancePath: instancePath + '/wdf',
          schemaPath: '#/properties/wdf/const',
          keyword: 'const',
          params: { allowedValue: '0.1' },
          message: 'must be equal to constant',
        };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.id !== undefined) {
      let data1 = data.id;
      if (typeof data1 === 'string') {
        if (!pattern4.test(data1)) {
          const err9 = {
            instancePath: instancePath + '/id',
            schemaPath: '#/properties/id/pattern',
            keyword: 'pattern',
            params: {
              pattern: '^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
            },
            message:
              'must match pattern "' +
              '^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' +
              '"',
          };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
      } else {
        const err10 = {
          instancePath: instancePath + '/id',
          schemaPath: '#/properties/id/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.title !== undefined) {
      let data2 = data.title;
      if (typeof data2 === 'string') {
        if (func2(data2) < 1) {
          const err11 = {
            instancePath: instancePath + '/title',
            schemaPath: '#/properties/title/minLength',
            keyword: 'minLength',
            params: { limit: 1 },
            message: 'must NOT have fewer than 1 characters',
          };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      } else {
        const err12 = {
          instancePath: instancePath + '/title',
          schemaPath: '#/properties/title/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.language !== undefined) {
      let data3 = data.language;
      if (typeof data3 === 'string') {
        if (!pattern5.test(data3)) {
          const err13 = {
            instancePath: instancePath + '/language',
            schemaPath: '#/properties/language/pattern',
            keyword: 'pattern',
            params: { pattern: '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$' },
            message: 'must match pattern "' + '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$' + '"',
          };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
      } else {
        const err14 = {
          instancePath: instancePath + '/language',
          schemaPath: '#/properties/language/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.authors !== undefined) {
      let data4 = data.authors;
      if (Array.isArray(data4)) {
        if (data4.length < 1) {
          const err15 = {
            instancePath: instancePath + '/authors',
            schemaPath: '#/properties/authors/minItems',
            keyword: 'minItems',
            params: { limit: 1 },
            message: 'must NOT have fewer than 1 items',
          };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
        const len0 = data4.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data5 = data4[i0];
          if (data5 && typeof data5 == 'object' && !Array.isArray(data5)) {
            if (data5.name === undefined) {
              const err16 = {
                instancePath: instancePath + '/authors/' + i0,
                schemaPath: '#/properties/authors/items/required',
                keyword: 'required',
                params: { missingProperty: 'name' },
                message: "must have required property '" + 'name' + "'",
              };
              if (vErrors === null) {
                vErrors = [err16];
              } else {
                vErrors.push(err16);
              }
              errors++;
            }
            for (const key1 in data5) {
              if (!(key1 === 'name' || key1 === 'role')) {
                const err17 = {
                  instancePath: instancePath + '/authors/' + i0,
                  schemaPath: '#/properties/authors/items/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key1 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err17];
                } else {
                  vErrors.push(err17);
                }
                errors++;
              }
            }
            if (data5.name !== undefined) {
              let data6 = data5.name;
              if (typeof data6 === 'string') {
                if (func2(data6) < 1) {
                  const err18 = {
                    instancePath: instancePath + '/authors/' + i0 + '/name',
                    schemaPath: '#/properties/authors/items/properties/name/minLength',
                    keyword: 'minLength',
                    params: { limit: 1 },
                    message: 'must NOT have fewer than 1 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err18];
                  } else {
                    vErrors.push(err18);
                  }
                  errors++;
                }
              } else {
                const err19 = {
                  instancePath: instancePath + '/authors/' + i0 + '/name',
                  schemaPath: '#/properties/authors/items/properties/name/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err19];
                } else {
                  vErrors.push(err19);
                }
                errors++;
              }
            }
            if (data5.role !== undefined) {
              let data7 = data5.role;
              if (typeof data7 === 'string') {
                if (func2(data7) < 1) {
                  const err20 = {
                    instancePath: instancePath + '/authors/' + i0 + '/role',
                    schemaPath: '#/properties/authors/items/properties/role/minLength',
                    keyword: 'minLength',
                    params: { limit: 1 },
                    message: 'must NOT have fewer than 1 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err20];
                  } else {
                    vErrors.push(err20);
                  }
                  errors++;
                }
              } else {
                const err21 = {
                  instancePath: instancePath + '/authors/' + i0 + '/role',
                  schemaPath: '#/properties/authors/items/properties/role/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err21];
                } else {
                  vErrors.push(err21);
                }
                errors++;
              }
            }
          } else {
            const err22 = {
              instancePath: instancePath + '/authors/' + i0,
              schemaPath: '#/properties/authors/items/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err22];
            } else {
              vErrors.push(err22);
            }
            errors++;
          }
        }
      } else {
        const err23 = {
          instancePath: instancePath + '/authors',
          schemaPath: '#/properties/authors/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    if (data.created !== undefined) {
      let data8 = data.created;
      if (typeof data8 === 'string') {
        if (!formats0.validate(data8)) {
          const err24 = {
            instancePath: instancePath + '/created',
            schemaPath: '#/properties/created/format',
            keyword: 'format',
            params: { format: 'date-time' },
            message: 'must match format "' + 'date-time' + '"',
          };
          if (vErrors === null) {
            vErrors = [err24];
          } else {
            vErrors.push(err24);
          }
          errors++;
        }
      } else {
        const err25 = {
          instancePath: instancePath + '/created',
          schemaPath: '#/properties/created/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err25];
        } else {
          vErrors.push(err25);
        }
        errors++;
      }
    }
    if (data.modified !== undefined) {
      let data9 = data.modified;
      if (typeof data9 === 'string') {
        if (!formats0.validate(data9)) {
          const err26 = {
            instancePath: instancePath + '/modified',
            schemaPath: '#/properties/modified/format',
            keyword: 'format',
            params: { format: 'date-time' },
            message: 'must match format "' + 'date-time' + '"',
          };
          if (vErrors === null) {
            vErrors = [err26];
          } else {
            vErrors.push(err26);
          }
          errors++;
        }
      } else {
        const err27 = {
          instancePath: instancePath + '/modified',
          schemaPath: '#/properties/modified/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.entry !== undefined) {
      if ('content/index.html' !== data.entry) {
        const err28 = {
          instancePath: instancePath + '/entry',
          schemaPath: '#/properties/entry/const',
          keyword: 'const',
          params: { allowedValue: 'content/index.html' },
          message: 'must be equal to constant',
        };
        if (vErrors === null) {
          vErrors = [err28];
        } else {
          vErrors.push(err28);
        }
        errors++;
      }
    }
    if (data.resources !== undefined) {
      let data11 = data.resources;
      if (Array.isArray(data11)) {
        const len1 = data11.length;
        for (let i1 = 0; i1 < len1; i1++) {
          let data12 = data11[i1];
          if (data12 && typeof data12 == 'object' && !Array.isArray(data12)) {
            if (data12.path === undefined) {
              const err29 = {
                instancePath: instancePath + '/resources/' + i1,
                schemaPath: '#/properties/resources/items/required',
                keyword: 'required',
                params: { missingProperty: 'path' },
                message: "must have required property '" + 'path' + "'",
              };
              if (vErrors === null) {
                vErrors = [err29];
              } else {
                vErrors.push(err29);
              }
              errors++;
            }
            if (data12.mediaType === undefined) {
              const err30 = {
                instancePath: instancePath + '/resources/' + i1,
                schemaPath: '#/properties/resources/items/required',
                keyword: 'required',
                params: { missingProperty: 'mediaType' },
                message: "must have required property '" + 'mediaType' + "'",
              };
              if (vErrors === null) {
                vErrors = [err30];
              } else {
                vErrors.push(err30);
              }
              errors++;
            }
            for (const key2 in data12) {
              if (!(key2 === 'path' || key2 === 'mediaType')) {
                const err31 = {
                  instancePath: instancePath + '/resources/' + i1,
                  schemaPath: '#/properties/resources/items/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key2 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err31];
                } else {
                  vErrors.push(err31);
                }
                errors++;
              }
            }
            if (data12.path !== undefined) {
              let data13 = data12.path;
              if (typeof data13 === 'string') {
                if (!pattern6.test(data13)) {
                  const err32 = {
                    instancePath: instancePath + '/resources/' + i1 + '/path',
                    schemaPath: '#/properties/resources/items/properties/path/pattern',
                    keyword: 'pattern',
                    params: { pattern: '^(content|data)(/[A-Za-z0-9][A-Za-z0-9._-]*)+$' },
                    message:
                      'must match pattern "' +
                      '^(content|data)(/[A-Za-z0-9][A-Za-z0-9._-]*)+$' +
                      '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err32];
                  } else {
                    vErrors.push(err32);
                  }
                  errors++;
                }
              } else {
                const err33 = {
                  instancePath: instancePath + '/resources/' + i1 + '/path',
                  schemaPath: '#/properties/resources/items/properties/path/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err33];
                } else {
                  vErrors.push(err33);
                }
                errors++;
              }
            }
            if (data12.mediaType !== undefined) {
              let data14 = data12.mediaType;
              if (typeof data14 === 'string') {
                if (!pattern7.test(data14)) {
                  const err34 = {
                    instancePath: instancePath + '/resources/' + i1 + '/mediaType',
                    schemaPath: '#/properties/resources/items/properties/mediaType/pattern',
                    keyword: 'pattern',
                    params: { pattern: '^[a-z]+/[A-Za-z0-9.+-]+$' },
                    message: 'must match pattern "' + '^[a-z]+/[A-Za-z0-9.+-]+$' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err34];
                  } else {
                    vErrors.push(err34);
                  }
                  errors++;
                }
              } else {
                const err35 = {
                  instancePath: instancePath + '/resources/' + i1 + '/mediaType',
                  schemaPath: '#/properties/resources/items/properties/mediaType/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err35];
                } else {
                  vErrors.push(err35);
                }
                errors++;
              }
            }
          } else {
            const err36 = {
              instancePath: instancePath + '/resources/' + i1,
              schemaPath: '#/properties/resources/items/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err36];
            } else {
              vErrors.push(err36);
            }
            errors++;
          }
        }
      } else {
        const err37 = {
          instancePath: instancePath + '/resources',
          schemaPath: '#/properties/resources/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err37];
        } else {
          vErrors.push(err37);
        }
        errors++;
      }
    }
    if (data.datasets !== undefined) {
      let data15 = data.datasets;
      if (Array.isArray(data15)) {
        const len2 = data15.length;
        for (let i2 = 0; i2 < len2; i2++) {
          let data16 = data15[i2];
          if (data16 && typeof data16 == 'object' && !Array.isArray(data16)) {
            if (data16.path === undefined) {
              const err38 = {
                instancePath: instancePath + '/datasets/' + i2,
                schemaPath: '#/properties/datasets/items/required',
                keyword: 'required',
                params: { missingProperty: 'path' },
                message: "must have required property '" + 'path' + "'",
              };
              if (vErrors === null) {
                vErrors = [err38];
              } else {
                vErrors.push(err38);
              }
              errors++;
            }
            if (data16.schema === undefined) {
              const err39 = {
                instancePath: instancePath + '/datasets/' + i2,
                schemaPath: '#/properties/datasets/items/required',
                keyword: 'required',
                params: { missingProperty: 'schema' },
                message: "must have required property '" + 'schema' + "'",
              };
              if (vErrors === null) {
                vErrors = [err39];
              } else {
                vErrors.push(err39);
              }
              errors++;
            }
            for (const key3 in data16) {
              if (!(key3 === 'path' || key3 === 'title' || key3 === 'schema')) {
                const err40 = {
                  instancePath: instancePath + '/datasets/' + i2,
                  schemaPath: '#/properties/datasets/items/additionalProperties',
                  keyword: 'additionalProperties',
                  params: { additionalProperty: key3 },
                  message: 'must NOT have additional properties',
                };
                if (vErrors === null) {
                  vErrors = [err40];
                } else {
                  vErrors.push(err40);
                }
                errors++;
              }
            }
            if (data16.path !== undefined) {
              let data17 = data16.path;
              if (typeof data17 === 'string') {
                if (!pattern8.test(data17)) {
                  const err41 = {
                    instancePath: instancePath + '/datasets/' + i2 + '/path',
                    schemaPath: '#/properties/datasets/items/properties/path/pattern',
                    keyword: 'pattern',
                    params: { pattern: '^data(/[A-Za-z0-9][A-Za-z0-9._-]*)+\\.json$' },
                    message:
                      'must match pattern "' + '^data(/[A-Za-z0-9][A-Za-z0-9._-]*)+\\.json$' + '"',
                  };
                  if (vErrors === null) {
                    vErrors = [err41];
                  } else {
                    vErrors.push(err41);
                  }
                  errors++;
                }
              } else {
                const err42 = {
                  instancePath: instancePath + '/datasets/' + i2 + '/path',
                  schemaPath: '#/properties/datasets/items/properties/path/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err42];
                } else {
                  vErrors.push(err42);
                }
                errors++;
              }
            }
            if (data16.title !== undefined) {
              let data18 = data16.title;
              if (typeof data18 === 'string') {
                if (func2(data18) < 1) {
                  const err43 = {
                    instancePath: instancePath + '/datasets/' + i2 + '/title',
                    schemaPath: '#/properties/datasets/items/properties/title/minLength',
                    keyword: 'minLength',
                    params: { limit: 1 },
                    message: 'must NOT have fewer than 1 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err43];
                  } else {
                    vErrors.push(err43);
                  }
                  errors++;
                }
              } else {
                const err44 = {
                  instancePath: instancePath + '/datasets/' + i2 + '/title',
                  schemaPath: '#/properties/datasets/items/properties/title/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err44];
                } else {
                  vErrors.push(err44);
                }
                errors++;
              }
            }
            if (data16.schema !== undefined) {
              let data19 = data16.schema;
              if (data19 && typeof data19 == 'object' && !Array.isArray(data19)) {
                if (data19.columns === undefined) {
                  const err45 = {
                    instancePath: instancePath + '/datasets/' + i2 + '/schema',
                    schemaPath: '#/properties/datasets/items/properties/schema/required',
                    keyword: 'required',
                    params: { missingProperty: 'columns' },
                    message: "must have required property '" + 'columns' + "'",
                  };
                  if (vErrors === null) {
                    vErrors = [err45];
                  } else {
                    vErrors.push(err45);
                  }
                  errors++;
                }
                for (const key4 in data19) {
                  if (!(key4 === 'columns')) {
                    const err46 = {
                      instancePath: instancePath + '/datasets/' + i2 + '/schema',
                      schemaPath:
                        '#/properties/datasets/items/properties/schema/additionalProperties',
                      keyword: 'additionalProperties',
                      params: { additionalProperty: key4 },
                      message: 'must NOT have additional properties',
                    };
                    if (vErrors === null) {
                      vErrors = [err46];
                    } else {
                      vErrors.push(err46);
                    }
                    errors++;
                  }
                }
                if (data19.columns !== undefined) {
                  let data20 = data19.columns;
                  if (Array.isArray(data20)) {
                    if (data20.length < 1) {
                      const err47 = {
                        instancePath: instancePath + '/datasets/' + i2 + '/schema/columns',
                        schemaPath:
                          '#/properties/datasets/items/properties/schema/properties/columns/minItems',
                        keyword: 'minItems',
                        params: { limit: 1 },
                        message: 'must NOT have fewer than 1 items',
                      };
                      if (vErrors === null) {
                        vErrors = [err47];
                      } else {
                        vErrors.push(err47);
                      }
                      errors++;
                    }
                    const len3 = data20.length;
                    for (let i3 = 0; i3 < len3; i3++) {
                      let data21 = data20[i3];
                      if (data21 && typeof data21 == 'object' && !Array.isArray(data21)) {
                        if (data21.name === undefined) {
                          const err48 = {
                            instancePath:
                              instancePath + '/datasets/' + i2 + '/schema/columns/' + i3,
                            schemaPath:
                              '#/properties/datasets/items/properties/schema/properties/columns/items/required',
                            keyword: 'required',
                            params: { missingProperty: 'name' },
                            message: "must have required property '" + 'name' + "'",
                          };
                          if (vErrors === null) {
                            vErrors = [err48];
                          } else {
                            vErrors.push(err48);
                          }
                          errors++;
                        }
                        if (data21.type === undefined) {
                          const err49 = {
                            instancePath:
                              instancePath + '/datasets/' + i2 + '/schema/columns/' + i3,
                            schemaPath:
                              '#/properties/datasets/items/properties/schema/properties/columns/items/required',
                            keyword: 'required',
                            params: { missingProperty: 'type' },
                            message: "must have required property '" + 'type' + "'",
                          };
                          if (vErrors === null) {
                            vErrors = [err49];
                          } else {
                            vErrors.push(err49);
                          }
                          errors++;
                        }
                        for (const key5 in data21) {
                          if (!(key5 === 'name' || key5 === 'type')) {
                            const err50 = {
                              instancePath:
                                instancePath + '/datasets/' + i2 + '/schema/columns/' + i3,
                              schemaPath:
                                '#/properties/datasets/items/properties/schema/properties/columns/items/additionalProperties',
                              keyword: 'additionalProperties',
                              params: { additionalProperty: key5 },
                              message: 'must NOT have additional properties',
                            };
                            if (vErrors === null) {
                              vErrors = [err50];
                            } else {
                              vErrors.push(err50);
                            }
                            errors++;
                          }
                        }
                        if (data21.name !== undefined) {
                          let data22 = data21.name;
                          if (typeof data22 === 'string') {
                            if (func2(data22) < 1) {
                              const err51 = {
                                instancePath:
                                  instancePath +
                                  '/datasets/' +
                                  i2 +
                                  '/schema/columns/' +
                                  i3 +
                                  '/name',
                                schemaPath:
                                  '#/properties/datasets/items/properties/schema/properties/columns/items/properties/name/minLength',
                                keyword: 'minLength',
                                params: { limit: 1 },
                                message: 'must NOT have fewer than 1 characters',
                              };
                              if (vErrors === null) {
                                vErrors = [err51];
                              } else {
                                vErrors.push(err51);
                              }
                              errors++;
                            }
                          } else {
                            const err52 = {
                              instancePath:
                                instancePath +
                                '/datasets/' +
                                i2 +
                                '/schema/columns/' +
                                i3 +
                                '/name',
                              schemaPath:
                                '#/properties/datasets/items/properties/schema/properties/columns/items/properties/name/type',
                              keyword: 'type',
                              params: { type: 'string' },
                              message: 'must be string',
                            };
                            if (vErrors === null) {
                              vErrors = [err52];
                            } else {
                              vErrors.push(err52);
                            }
                            errors++;
                          }
                        }
                        if (data21.type !== undefined) {
                          let data23 = data21.type;
                          if (!(
                            data23 === 'string' ||
                            data23 === 'integer' ||
                            data23 === 'number' ||
                            data23 === 'boolean' ||
                            data23 === 'date'
                          )) {
                            const err53 = {
                              instancePath:
                                instancePath +
                                '/datasets/' +
                                i2 +
                                '/schema/columns/' +
                                i3 +
                                '/type',
                              schemaPath:
                                '#/properties/datasets/items/properties/schema/properties/columns/items/properties/type/enum',
                              keyword: 'enum',
                              params: {
                                allowedValues:
                                  schema31.properties.datasets.items.properties.schema.properties
                                    .columns.items.properties.type.enum,
                              },
                              message: 'must be equal to one of the allowed values',
                            };
                            if (vErrors === null) {
                              vErrors = [err53];
                            } else {
                              vErrors.push(err53);
                            }
                            errors++;
                          }
                        }
                      } else {
                        const err54 = {
                          instancePath: instancePath + '/datasets/' + i2 + '/schema/columns/' + i3,
                          schemaPath:
                            '#/properties/datasets/items/properties/schema/properties/columns/items/type',
                          keyword: 'type',
                          params: { type: 'object' },
                          message: 'must be object',
                        };
                        if (vErrors === null) {
                          vErrors = [err54];
                        } else {
                          vErrors.push(err54);
                        }
                        errors++;
                      }
                    }
                  } else {
                    const err55 = {
                      instancePath: instancePath + '/datasets/' + i2 + '/schema/columns',
                      schemaPath:
                        '#/properties/datasets/items/properties/schema/properties/columns/type',
                      keyword: 'type',
                      params: { type: 'array' },
                      message: 'must be array',
                    };
                    if (vErrors === null) {
                      vErrors = [err55];
                    } else {
                      vErrors.push(err55);
                    }
                    errors++;
                  }
                }
              } else {
                const err56 = {
                  instancePath: instancePath + '/datasets/' + i2 + '/schema',
                  schemaPath: '#/properties/datasets/items/properties/schema/type',
                  keyword: 'type',
                  params: { type: 'object' },
                  message: 'must be object',
                };
                if (vErrors === null) {
                  vErrors = [err56];
                } else {
                  vErrors.push(err56);
                }
                errors++;
              }
            }
          } else {
            const err57 = {
              instancePath: instancePath + '/datasets/' + i2,
              schemaPath: '#/properties/datasets/items/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err57];
            } else {
              vErrors.push(err57);
            }
            errors++;
          }
        }
      } else {
        const err58 = {
          instancePath: instancePath + '/datasets',
          schemaPath: '#/properties/datasets/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err58];
        } else {
          vErrors.push(err58);
        }
        errors++;
      }
    }
    if (data.extensions !== undefined) {
      let data24 = data.extensions;
      if (Array.isArray(data24)) {
        const len4 = data24.length;
        for (let i4 = 0; i4 < len4; i4++) {
          let data25 = data24[i4];
          if (data25 && typeof data25 == 'object' && !Array.isArray(data25)) {
            if (data25.name === undefined) {
              const err59 = {
                instancePath: instancePath + '/extensions/' + i4,
                schemaPath: '#/properties/extensions/items/required',
                keyword: 'required',
                params: { missingProperty: 'name' },
                message: "must have required property '" + 'name' + "'",
              };
              if (vErrors === null) {
                vErrors = [err59];
              } else {
                vErrors.push(err59);
              }
              errors++;
            }
            if (data25.name !== undefined) {
              let data26 = data25.name;
              if (typeof data26 === 'string') {
                if (func2(data26) < 1) {
                  const err60 = {
                    instancePath: instancePath + '/extensions/' + i4 + '/name',
                    schemaPath: '#/properties/extensions/items/properties/name/minLength',
                    keyword: 'minLength',
                    params: { limit: 1 },
                    message: 'must NOT have fewer than 1 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err60];
                  } else {
                    vErrors.push(err60);
                  }
                  errors++;
                }
              } else {
                const err61 = {
                  instancePath: instancePath + '/extensions/' + i4 + '/name',
                  schemaPath: '#/properties/extensions/items/properties/name/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err61];
                } else {
                  vErrors.push(err61);
                }
                errors++;
              }
            }
            if (data25.version !== undefined) {
              let data27 = data25.version;
              if (typeof data27 === 'string') {
                if (func2(data27) < 1) {
                  const err62 = {
                    instancePath: instancePath + '/extensions/' + i4 + '/version',
                    schemaPath: '#/properties/extensions/items/properties/version/minLength',
                    keyword: 'minLength',
                    params: { limit: 1 },
                    message: 'must NOT have fewer than 1 characters',
                  };
                  if (vErrors === null) {
                    vErrors = [err62];
                  } else {
                    vErrors.push(err62);
                  }
                  errors++;
                }
              } else {
                const err63 = {
                  instancePath: instancePath + '/extensions/' + i4 + '/version',
                  schemaPath: '#/properties/extensions/items/properties/version/type',
                  keyword: 'type',
                  params: { type: 'string' },
                  message: 'must be string',
                };
                if (vErrors === null) {
                  vErrors = [err63];
                } else {
                  vErrors.push(err63);
                }
                errors++;
              }
            }
          } else {
            const err64 = {
              instancePath: instancePath + '/extensions/' + i4,
              schemaPath: '#/properties/extensions/items/type',
              keyword: 'type',
              params: { type: 'object' },
              message: 'must be object',
            };
            if (vErrors === null) {
              vErrors = [err64];
            } else {
              vErrors.push(err64);
            }
            errors++;
          }
        }
      } else {
        const err65 = {
          instancePath: instancePath + '/extensions',
          schemaPath: '#/properties/extensions/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err65];
        } else {
          vErrors.push(err65);
        }
        errors++;
      }
    }
  } else {
    const err66 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err66];
    } else {
      vErrors.push(err66);
    }
    errors++;
  }
  validate20.errors = vErrors;
  return errors === 0;
}
validate20.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
export const validateOutline = validate21;
const schema32 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wdf.dev/schemas/0.1/outline.schema.json',
  title: 'WDF Core 0.1 — ai/outline.json',
  description:
    'Ordered structure map of the document: one node per citable element, in document order (WDF Core 0.1 §ai-layer). Node ids MUST be unique and MUST match the id attributes in content/index.html; uniqueness and cross-references are enforced by the validator, not by this schema.',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'type', 'parent'],
    properties: {
      id: {
        description:
          'Stable element id: type prefix + slug or counter (e.g. sec-introduction, p-0012, tbl-spesa-2025).',
        type: 'string',
        pattern: '^[a-z]+-[a-z0-9][a-z0-9-]*$',
      },
      type: {
        enum: ['section', 'heading', 'paragraph', 'table', 'figure', 'blockquote', 'list-item'],
      },
      level: {
        description: 'Heading level; present if and only if type is "heading".',
        type: 'integer',
        minimum: 1,
        maximum: 6,
      },
      title: { type: 'string', minLength: 1 },
      parent: {
        description: 'id of the containing node, or null for top-level nodes.',
        oneOf: [{ type: 'null' }, { type: 'string', pattern: '^[a-z]+-[a-z0-9][a-z0-9-]*$' }],
      },
    },
    if: { properties: { type: { const: 'heading' } }, required: ['type'] },
    then: { required: ['level'] },
    else: { not: { required: ['level'] } },
  },
};
const pattern9 = new RegExp('^[a-z]+-[a-z0-9][a-z0-9-]*$', 'u');
function validate21(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  /*# sourceURL="https://wdf.dev/schemas/0.1/outline.schema.json" */ let vErrors = null;
  let errors = 0;
  const evaluated0 = validate21.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (Array.isArray(data)) {
    const len0 = data.length;
    for (let i0 = 0; i0 < len0; i0++) {
      let data0 = data[i0];
      const _errs3 = errors;
      let valid2 = true;
      const _errs4 = errors;
      if (data0 && typeof data0 == 'object' && !Array.isArray(data0)) {
        let missing0;
        if (data0.type === undefined && (missing0 = 'type')) {
          const err0 = {};
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        } else {
          if (data0.type !== undefined) {
            if ('heading' !== data0.type) {
              const err1 = {};
              if (vErrors === null) {
                vErrors = [err1];
              } else {
                vErrors.push(err1);
              }
              errors++;
            }
          }
        }
      }
      var _valid0 = _errs4 === errors;
      errors = _errs3;
      if (vErrors !== null) {
        if (_errs3) {
          vErrors.length = _errs3;
        } else {
          vErrors = null;
        }
      }
      let ifClause0;
      if (_valid0) {
        const _errs6 = errors;
        if (data0 && typeof data0 == 'object' && !Array.isArray(data0)) {
          if (data0.level === undefined) {
            const err2 = {
              instancePath: instancePath + '/' + i0,
              schemaPath: '#/items/then/required',
              keyword: 'required',
              params: { missingProperty: 'level' },
              message: "must have required property '" + 'level' + "'",
            };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
          }
        }
        var _valid0 = _errs6 === errors;
        valid2 = _valid0;
        ifClause0 = 'then';
      } else {
        const _errs7 = errors;
        const _errs8 = errors;
        const _errs9 = errors;
        if (data0 && typeof data0 == 'object' && !Array.isArray(data0)) {
          let missing1;
          if (data0.level === undefined && (missing1 = 'level')) {
            const err3 = {};
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
          }
        }
        var valid4 = _errs9 === errors;
        if (valid4) {
          const err4 = {
            instancePath: instancePath + '/' + i0,
            schemaPath: '#/items/else/not',
            keyword: 'not',
            params: {},
            message: 'must NOT be valid',
          };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        } else {
          errors = _errs8;
          if (vErrors !== null) {
            if (_errs8) {
              vErrors.length = _errs8;
            } else {
              vErrors = null;
            }
          }
        }
        var _valid0 = _errs7 === errors;
        valid2 = _valid0;
        ifClause0 = 'else';
      }
      if (!valid2) {
        const err5 = {
          instancePath: instancePath + '/' + i0,
          schemaPath: '#/items/if',
          keyword: 'if',
          params: { failingKeyword: ifClause0 },
          message: 'must match "' + ifClause0 + '" schema',
        };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
      if (data0 && typeof data0 == 'object' && !Array.isArray(data0)) {
        if (data0.id === undefined) {
          const err6 = {
            instancePath: instancePath + '/' + i0,
            schemaPath: '#/items/required',
            keyword: 'required',
            params: { missingProperty: 'id' },
            message: "must have required property '" + 'id' + "'",
          };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
        if (data0.type === undefined) {
          const err7 = {
            instancePath: instancePath + '/' + i0,
            schemaPath: '#/items/required',
            keyword: 'required',
            params: { missingProperty: 'type' },
            message: "must have required property '" + 'type' + "'",
          };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
        if (data0.parent === undefined) {
          const err8 = {
            instancePath: instancePath + '/' + i0,
            schemaPath: '#/items/required',
            keyword: 'required',
            params: { missingProperty: 'parent' },
            message: "must have required property '" + 'parent' + "'",
          };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
        for (const key0 in data0) {
          if (!(
            key0 === 'id' ||
            key0 === 'type' ||
            key0 === 'level' ||
            key0 === 'title' ||
            key0 === 'parent'
          )) {
            const err9 = {
              instancePath: instancePath + '/' + i0,
              schemaPath: '#/items/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key0 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
        if (data0.id !== undefined) {
          let data2 = data0.id;
          if (typeof data2 === 'string') {
            if (!pattern9.test(data2)) {
              const err10 = {
                instancePath: instancePath + '/' + i0 + '/id',
                schemaPath: '#/items/properties/id/pattern',
                keyword: 'pattern',
                params: { pattern: '^[a-z]+-[a-z0-9][a-z0-9-]*$' },
                message: 'must match pattern "' + '^[a-z]+-[a-z0-9][a-z0-9-]*$' + '"',
              };
              if (vErrors === null) {
                vErrors = [err10];
              } else {
                vErrors.push(err10);
              }
              errors++;
            }
          } else {
            const err11 = {
              instancePath: instancePath + '/' + i0 + '/id',
              schemaPath: '#/items/properties/id/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err11];
            } else {
              vErrors.push(err11);
            }
            errors++;
          }
        }
        if (data0.type !== undefined) {
          let data3 = data0.type;
          if (!(
            data3 === 'section' ||
            data3 === 'heading' ||
            data3 === 'paragraph' ||
            data3 === 'table' ||
            data3 === 'figure' ||
            data3 === 'blockquote' ||
            data3 === 'list-item'
          )) {
            const err12 = {
              instancePath: instancePath + '/' + i0 + '/type',
              schemaPath: '#/items/properties/type/enum',
              keyword: 'enum',
              params: { allowedValues: schema32.items.properties.type.enum },
              message: 'must be equal to one of the allowed values',
            };
            if (vErrors === null) {
              vErrors = [err12];
            } else {
              vErrors.push(err12);
            }
            errors++;
          }
        }
        if (data0.level !== undefined) {
          let data4 = data0.level;
          if (!(typeof data4 == 'number' && !(data4 % 1) && !isNaN(data4) && isFinite(data4))) {
            const err13 = {
              instancePath: instancePath + '/' + i0 + '/level',
              schemaPath: '#/items/properties/level/type',
              keyword: 'type',
              params: { type: 'integer' },
              message: 'must be integer',
            };
            if (vErrors === null) {
              vErrors = [err13];
            } else {
              vErrors.push(err13);
            }
            errors++;
          }
          if (typeof data4 == 'number' && isFinite(data4)) {
            if (data4 > 6 || isNaN(data4)) {
              const err14 = {
                instancePath: instancePath + '/' + i0 + '/level',
                schemaPath: '#/items/properties/level/maximum',
                keyword: 'maximum',
                params: { comparison: '<=', limit: 6 },
                message: 'must be <= 6',
              };
              if (vErrors === null) {
                vErrors = [err14];
              } else {
                vErrors.push(err14);
              }
              errors++;
            }
            if (data4 < 1 || isNaN(data4)) {
              const err15 = {
                instancePath: instancePath + '/' + i0 + '/level',
                schemaPath: '#/items/properties/level/minimum',
                keyword: 'minimum',
                params: { comparison: '>=', limit: 1 },
                message: 'must be >= 1',
              };
              if (vErrors === null) {
                vErrors = [err15];
              } else {
                vErrors.push(err15);
              }
              errors++;
            }
          }
        }
        if (data0.title !== undefined) {
          let data5 = data0.title;
          if (typeof data5 === 'string') {
            if (func2(data5) < 1) {
              const err16 = {
                instancePath: instancePath + '/' + i0 + '/title',
                schemaPath: '#/items/properties/title/minLength',
                keyword: 'minLength',
                params: { limit: 1 },
                message: 'must NOT have fewer than 1 characters',
              };
              if (vErrors === null) {
                vErrors = [err16];
              } else {
                vErrors.push(err16);
              }
              errors++;
            }
          } else {
            const err17 = {
              instancePath: instancePath + '/' + i0 + '/title',
              schemaPath: '#/items/properties/title/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err17];
            } else {
              vErrors.push(err17);
            }
            errors++;
          }
        }
        if (data0.parent !== undefined) {
          let data6 = data0.parent;
          const _errs19 = errors;
          let valid6 = false;
          let passing0 = null;
          const _errs20 = errors;
          if (data6 !== null) {
            const err18 = {
              instancePath: instancePath + '/' + i0 + '/parent',
              schemaPath: '#/items/properties/parent/oneOf/0/type',
              keyword: 'type',
              params: { type: 'null' },
              message: 'must be null',
            };
            if (vErrors === null) {
              vErrors = [err18];
            } else {
              vErrors.push(err18);
            }
            errors++;
          }
          var _valid1 = _errs20 === errors;
          if (_valid1) {
            valid6 = true;
            passing0 = 0;
          }
          const _errs22 = errors;
          if (typeof data6 === 'string') {
            if (!pattern9.test(data6)) {
              const err19 = {
                instancePath: instancePath + '/' + i0 + '/parent',
                schemaPath: '#/items/properties/parent/oneOf/1/pattern',
                keyword: 'pattern',
                params: { pattern: '^[a-z]+-[a-z0-9][a-z0-9-]*$' },
                message: 'must match pattern "' + '^[a-z]+-[a-z0-9][a-z0-9-]*$' + '"',
              };
              if (vErrors === null) {
                vErrors = [err19];
              } else {
                vErrors.push(err19);
              }
              errors++;
            }
          } else {
            const err20 = {
              instancePath: instancePath + '/' + i0 + '/parent',
              schemaPath: '#/items/properties/parent/oneOf/1/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err20];
            } else {
              vErrors.push(err20);
            }
            errors++;
          }
          var _valid1 = _errs22 === errors;
          if (_valid1 && valid6) {
            valid6 = false;
            passing0 = [passing0, 1];
          } else {
            if (_valid1) {
              valid6 = true;
              passing0 = 1;
            }
          }
          if (!valid6) {
            const err21 = {
              instancePath: instancePath + '/' + i0 + '/parent',
              schemaPath: '#/items/properties/parent/oneOf',
              keyword: 'oneOf',
              params: { passingSchemas: passing0 },
              message: 'must match exactly one schema in oneOf',
            };
            if (vErrors === null) {
              vErrors = [err21];
            } else {
              vErrors.push(err21);
            }
            errors++;
          } else {
            errors = _errs19;
            if (vErrors !== null) {
              if (_errs19) {
                vErrors.length = _errs19;
              } else {
                vErrors = null;
              }
            }
          }
        }
      } else {
        const err22 = {
          instancePath: instancePath + '/' + i0,
          schemaPath: '#/items/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
    }
  } else {
    const err23 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'array' },
      message: 'must be array',
    };
    if (vErrors === null) {
      vErrors = [err23];
    } else {
      vErrors.push(err23);
    }
    errors++;
  }
  validate21.errors = vErrors;
  return errors === 0;
}
validate21.evaluated = { items: true, dynamicProps: false, dynamicItems: false };
export const validateHashes = validate22;
const schema33 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wdf.dev/schemas/0.1/hashes.schema.json',
  title: 'WDF Core 0.1 — integrity/hashes.json',
  description:
    'SHA-256 digest of every file in the package except integrity/hashes.json itself (WDF Core 0.1 §integrity). The key pattern excludes the integrity/ directory, which contains only this file.',
  type: 'object',
  additionalProperties: false,
  required: ['algorithm', 'files'],
  properties: {
    algorithm: { const: 'sha256' },
    files: {
      type: 'object',
      minProperties: 1,
      propertyNames: {
        pattern: '^(manifest\\.json|(content|data|ai|ext)(/[A-Za-z0-9][A-Za-z0-9._-]*)+)$',
      },
      additionalProperties: {
        description: 'Lowercase hex SHA-256 digest.',
        type: 'string',
        pattern: '^[0-9a-f]{64}$',
      },
    },
  },
};
const pattern11 = new RegExp(
  '^(manifest\\.json|(content|data|ai|ext)(/[A-Za-z0-9][A-Za-z0-9._-]*)+)$',
  'u',
);
const pattern12 = new RegExp('^[0-9a-f]{64}$', 'u');
function validate22(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  /*# sourceURL="https://wdf.dev/schemas/0.1/hashes.schema.json" */ let vErrors = null;
  let errors = 0;
  const evaluated0 = validate22.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.algorithm === undefined) {
      const err0 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'algorithm' },
        message: "must have required property '" + 'algorithm' + "'",
      };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.files === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'files' },
        message: "must have required property '" + 'files' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === 'algorithm' || key0 === 'files')) {
        const err2 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.algorithm !== undefined) {
      if ('sha256' !== data.algorithm) {
        const err3 = {
          instancePath: instancePath + '/algorithm',
          schemaPath: '#/properties/algorithm/const',
          keyword: 'const',
          params: { allowedValue: 'sha256' },
          message: 'must be equal to constant',
        };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.files !== undefined) {
      let data1 = data.files;
      if (data1 && typeof data1 == 'object' && !Array.isArray(data1)) {
        if (Object.keys(data1).length < 1) {
          const err4 = {
            instancePath: instancePath + '/files',
            schemaPath: '#/properties/files/minProperties',
            keyword: 'minProperties',
            params: { limit: 1 },
            message: 'must NOT have fewer than 1 properties',
          };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
        for (const key1 in data1) {
          const _errs5 = errors;
          if (typeof key1 === 'string') {
            if (!pattern11.test(key1)) {
              const err5 = {
                instancePath: instancePath + '/files',
                schemaPath: '#/properties/files/propertyNames/pattern',
                keyword: 'pattern',
                params: {
                  pattern:
                    '^(manifest\\.json|(content|data|ai|ext)(/[A-Za-z0-9][A-Za-z0-9._-]*)+)$',
                },
                message:
                  'must match pattern "' +
                  '^(manifest\\.json|(content|data|ai|ext)(/[A-Za-z0-9][A-Za-z0-9._-]*)+)$' +
                  '"',
                propertyName: key1,
              };
              if (vErrors === null) {
                vErrors = [err5];
              } else {
                vErrors.push(err5);
              }
              errors++;
            }
          }
          var valid1 = _errs5 === errors;
          if (!valid1) {
            const err6 = {
              instancePath: instancePath + '/files',
              schemaPath: '#/properties/files/propertyNames',
              keyword: 'propertyNames',
              params: { propertyName: key1 },
              message: 'property name must be valid',
            };
            if (vErrors === null) {
              vErrors = [err6];
            } else {
              vErrors.push(err6);
            }
            errors++;
          }
        }
        for (const key2 in data1) {
          let data2 = data1[key2];
          if (typeof data2 === 'string') {
            if (!pattern12.test(data2)) {
              const err7 = {
                instancePath:
                  instancePath + '/files/' + key2.replace(/~/g, '~0').replace(/\//g, '~1'),
                schemaPath: '#/properties/files/additionalProperties/pattern',
                keyword: 'pattern',
                params: { pattern: '^[0-9a-f]{64}$' },
                message: 'must match pattern "' + '^[0-9a-f]{64}$' + '"',
              };
              if (vErrors === null) {
                vErrors = [err7];
              } else {
                vErrors.push(err7);
              }
              errors++;
            }
          } else {
            const err8 = {
              instancePath:
                instancePath + '/files/' + key2.replace(/~/g, '~0').replace(/\//g, '~1'),
              schemaPath: '#/properties/files/additionalProperties/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err8];
            } else {
              vErrors.push(err8);
            }
            errors++;
          }
        }
      } else {
        const err9 = {
          instancePath: instancePath + '/files',
          schemaPath: '#/properties/files/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
  } else {
    const err10 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err10];
    } else {
      vErrors.push(err10);
    }
    errors++;
  }
  validate22.errors = vErrors;
  return errors === 0;
}
validate22.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
export const validateCapture = validate23;
const schema34 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wdf.dev/schemas/ext/capture/0.1/capture.schema.json',
  title: 'WDF extension `capture` 0.1 — capture.json',
  description:
    'Provenance metadata of a live-page capture (docs/ext-capture.md §4). An extension schema, not part of WDF Core.',
  type: 'object',
  additionalProperties: false,
  required: ['capture', 'url', 'capturedAt', 'userAgent', 'viewport', 'mode'],
  properties: {
    capture: {
      description: 'Version of the capture extension the file conforms to.',
      const: '0.1',
    },
    url: {
      description: 'Page address at capture time (http/https only).',
      type: 'string',
      pattern: '^https?://[^\\s<>]+$',
    },
    capturedAt: {
      description: 'Capture instant (RFC 3339 date-time).',
      type: 'string',
      format: 'date-time',
    },
    userAgent: {
      description: 'User agent string of the capturing browser.',
      type: 'string',
      minLength: 1,
    },
    viewport: {
      description: 'Layout viewport at capture time (CSS pixels).',
      type: 'object',
      additionalProperties: false,
      required: ['width', 'height'],
      properties: {
        width: { type: 'integer', minimum: 1 },
        height: { type: 'integer', minimum: 1 },
        devicePixelRatio: { type: 'number', exclusiveMinimum: 0 },
      },
    },
    mode: {
      description: 'What was captured: the extracted article or the whole page.',
      enum: ['article', 'full-page'],
    },
  },
};
const pattern13 = new RegExp('^https?://[^\\s<>]+$', 'u');
function validate23(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  /*# sourceURL="https://wdf.dev/schemas/ext/capture/0.1/capture.schema.json" */ let vErrors = null;
  let errors = 0;
  const evaluated0 = validate23.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.capture === undefined) {
      const err0 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'capture' },
        message: "must have required property '" + 'capture' + "'",
      };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.url === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'url' },
        message: "must have required property '" + 'url' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.capturedAt === undefined) {
      const err2 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'capturedAt' },
        message: "must have required property '" + 'capturedAt' + "'",
      };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.userAgent === undefined) {
      const err3 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'userAgent' },
        message: "must have required property '" + 'userAgent' + "'",
      };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.viewport === undefined) {
      const err4 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'viewport' },
        message: "must have required property '" + 'viewport' + "'",
      };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.mode === undefined) {
      const err5 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'mode' },
        message: "must have required property '" + 'mode' + "'",
      };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(
        key0 === 'capture' ||
        key0 === 'url' ||
        key0 === 'capturedAt' ||
        key0 === 'userAgent' ||
        key0 === 'viewport' ||
        key0 === 'mode'
      )) {
        const err6 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.capture !== undefined) {
      if ('0.1' !== data.capture) {
        const err7 = {
          instancePath: instancePath + '/capture',
          schemaPath: '#/properties/capture/const',
          keyword: 'const',
          params: { allowedValue: '0.1' },
          message: 'must be equal to constant',
        };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.url !== undefined) {
      let data1 = data.url;
      if (typeof data1 === 'string') {
        if (!pattern13.test(data1)) {
          const err8 = {
            instancePath: instancePath + '/url',
            schemaPath: '#/properties/url/pattern',
            keyword: 'pattern',
            params: { pattern: '^https?://[^\\s<>]+$' },
            message: 'must match pattern "' + '^https?://[^\\s<>]+$' + '"',
          };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = {
          instancePath: instancePath + '/url',
          schemaPath: '#/properties/url/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.capturedAt !== undefined) {
      let data2 = data.capturedAt;
      if (typeof data2 === 'string') {
        if (!formats0.validate(data2)) {
          const err10 = {
            instancePath: instancePath + '/capturedAt',
            schemaPath: '#/properties/capturedAt/format',
            keyword: 'format',
            params: { format: 'date-time' },
            message: 'must match format "' + 'date-time' + '"',
          };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = {
          instancePath: instancePath + '/capturedAt',
          schemaPath: '#/properties/capturedAt/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.userAgent !== undefined) {
      let data3 = data.userAgent;
      if (typeof data3 === 'string') {
        if (func2(data3) < 1) {
          const err12 = {
            instancePath: instancePath + '/userAgent',
            schemaPath: '#/properties/userAgent/minLength',
            keyword: 'minLength',
            params: { limit: 1 },
            message: 'must NOT have fewer than 1 characters',
          };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
      } else {
        const err13 = {
          instancePath: instancePath + '/userAgent',
          schemaPath: '#/properties/userAgent/type',
          keyword: 'type',
          params: { type: 'string' },
          message: 'must be string',
        };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.viewport !== undefined) {
      let data4 = data.viewport;
      if (data4 && typeof data4 == 'object' && !Array.isArray(data4)) {
        if (data4.width === undefined) {
          const err14 = {
            instancePath: instancePath + '/viewport',
            schemaPath: '#/properties/viewport/required',
            keyword: 'required',
            params: { missingProperty: 'width' },
            message: "must have required property '" + 'width' + "'",
          };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
        if (data4.height === undefined) {
          const err15 = {
            instancePath: instancePath + '/viewport',
            schemaPath: '#/properties/viewport/required',
            keyword: 'required',
            params: { missingProperty: 'height' },
            message: "must have required property '" + 'height' + "'",
          };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
        for (const key1 in data4) {
          if (!(key1 === 'width' || key1 === 'height' || key1 === 'devicePixelRatio')) {
            const err16 = {
              instancePath: instancePath + '/viewport',
              schemaPath: '#/properties/viewport/additionalProperties',
              keyword: 'additionalProperties',
              params: { additionalProperty: key1 },
              message: 'must NOT have additional properties',
            };
            if (vErrors === null) {
              vErrors = [err16];
            } else {
              vErrors.push(err16);
            }
            errors++;
          }
        }
        if (data4.width !== undefined) {
          let data5 = data4.width;
          if (!(typeof data5 == 'number' && !(data5 % 1) && !isNaN(data5) && isFinite(data5))) {
            const err17 = {
              instancePath: instancePath + '/viewport/width',
              schemaPath: '#/properties/viewport/properties/width/type',
              keyword: 'type',
              params: { type: 'integer' },
              message: 'must be integer',
            };
            if (vErrors === null) {
              vErrors = [err17];
            } else {
              vErrors.push(err17);
            }
            errors++;
          }
          if (typeof data5 == 'number' && isFinite(data5)) {
            if (data5 < 1 || isNaN(data5)) {
              const err18 = {
                instancePath: instancePath + '/viewport/width',
                schemaPath: '#/properties/viewport/properties/width/minimum',
                keyword: 'minimum',
                params: { comparison: '>=', limit: 1 },
                message: 'must be >= 1',
              };
              if (vErrors === null) {
                vErrors = [err18];
              } else {
                vErrors.push(err18);
              }
              errors++;
            }
          }
        }
        if (data4.height !== undefined) {
          let data6 = data4.height;
          if (!(typeof data6 == 'number' && !(data6 % 1) && !isNaN(data6) && isFinite(data6))) {
            const err19 = {
              instancePath: instancePath + '/viewport/height',
              schemaPath: '#/properties/viewport/properties/height/type',
              keyword: 'type',
              params: { type: 'integer' },
              message: 'must be integer',
            };
            if (vErrors === null) {
              vErrors = [err19];
            } else {
              vErrors.push(err19);
            }
            errors++;
          }
          if (typeof data6 == 'number' && isFinite(data6)) {
            if (data6 < 1 || isNaN(data6)) {
              const err20 = {
                instancePath: instancePath + '/viewport/height',
                schemaPath: '#/properties/viewport/properties/height/minimum',
                keyword: 'minimum',
                params: { comparison: '>=', limit: 1 },
                message: 'must be >= 1',
              };
              if (vErrors === null) {
                vErrors = [err20];
              } else {
                vErrors.push(err20);
              }
              errors++;
            }
          }
        }
        if (data4.devicePixelRatio !== undefined) {
          let data7 = data4.devicePixelRatio;
          if (typeof data7 == 'number' && isFinite(data7)) {
            if (data7 <= 0 || isNaN(data7)) {
              const err21 = {
                instancePath: instancePath + '/viewport/devicePixelRatio',
                schemaPath: '#/properties/viewport/properties/devicePixelRatio/exclusiveMinimum',
                keyword: 'exclusiveMinimum',
                params: { comparison: '>', limit: 0 },
                message: 'must be > 0',
              };
              if (vErrors === null) {
                vErrors = [err21];
              } else {
                vErrors.push(err21);
              }
              errors++;
            }
          } else {
            const err22 = {
              instancePath: instancePath + '/viewport/devicePixelRatio',
              schemaPath: '#/properties/viewport/properties/devicePixelRatio/type',
              keyword: 'type',
              params: { type: 'number' },
              message: 'must be number',
            };
            if (vErrors === null) {
              vErrors = [err22];
            } else {
              vErrors.push(err22);
            }
            errors++;
          }
        }
      } else {
        const err23 = {
          instancePath: instancePath + '/viewport',
          schemaPath: '#/properties/viewport/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    if (data.mode !== undefined) {
      let data8 = data.mode;
      if (!(data8 === 'article' || data8 === 'full-page')) {
        const err24 = {
          instancePath: instancePath + '/mode',
          schemaPath: '#/properties/mode/enum',
          keyword: 'enum',
          params: { allowedValues: schema34.properties.mode.enum },
          message: 'must be equal to one of the allowed values',
        };
        if (vErrors === null) {
          vErrors = [err24];
        } else {
          vErrors.push(err24);
        }
        errors++;
      }
    }
  } else {
    const err25 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err25];
    } else {
      vErrors.push(err25);
    }
    errors++;
  }
  validate23.errors = vErrors;
  return errors === 0;
}
validate23.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
export const validatePagination = validate24;
const schema35 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wdf.dev/schemas/ext/pagination/0.1/pagination.schema.json',
  title: 'WDF extension `pagination` 0.1 — pagination.json',
  description:
    'Authored page breaks anchored to stable element ids (docs/ext-pagination.md §4). An extension schema, not part of WDF Core.',
  type: 'object',
  additionalProperties: false,
  required: ['pagination', 'breakBefore'],
  properties: {
    pagination: {
      description: 'Version of the pagination extension the file conforms to.',
      const: '0.1',
    },
    breakBefore: {
      description: 'Element ids (§6.4.2 syntax) a page begins before, unique, in document order.',
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'string', pattern: '^[a-z]+-[a-z0-9][a-z0-9-]*$' },
    },
  },
};
function validate24(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {},
) {
  /*# sourceURL="https://wdf.dev/schemas/ext/pagination/0.1/pagination.schema.json" */ let vErrors =
    null;
  let errors = 0;
  const evaluated0 = validate24.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (data && typeof data == 'object' && !Array.isArray(data)) {
    if (data.pagination === undefined) {
      const err0 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'pagination' },
        message: "must have required property '" + 'pagination' + "'",
      };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.breakBefore === undefined) {
      const err1 = {
        instancePath,
        schemaPath: '#/required',
        keyword: 'required',
        params: { missingProperty: 'breakBefore' },
        message: "must have required property '" + 'breakBefore' + "'",
      };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === 'pagination' || key0 === 'breakBefore')) {
        const err2 = {
          instancePath,
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: { additionalProperty: key0 },
          message: 'must NOT have additional properties',
        };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.pagination !== undefined) {
      if ('0.1' !== data.pagination) {
        const err3 = {
          instancePath: instancePath + '/pagination',
          schemaPath: '#/properties/pagination/const',
          keyword: 'const',
          params: { allowedValue: '0.1' },
          message: 'must be equal to constant',
        };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.breakBefore !== undefined) {
      let data1 = data.breakBefore;
      if (Array.isArray(data1)) {
        if (data1.length < 1) {
          const err4 = {
            instancePath: instancePath + '/breakBefore',
            schemaPath: '#/properties/breakBefore/minItems',
            keyword: 'minItems',
            params: { limit: 1 },
            message: 'must NOT have fewer than 1 items',
          };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
        const len0 = data1.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data2 = data1[i0];
          if (typeof data2 === 'string') {
            if (!pattern9.test(data2)) {
              const err5 = {
                instancePath: instancePath + '/breakBefore/' + i0,
                schemaPath: '#/properties/breakBefore/items/pattern',
                keyword: 'pattern',
                params: { pattern: '^[a-z]+-[a-z0-9][a-z0-9-]*$' },
                message: 'must match pattern "' + '^[a-z]+-[a-z0-9][a-z0-9-]*$' + '"',
              };
              if (vErrors === null) {
                vErrors = [err5];
              } else {
                vErrors.push(err5);
              }
              errors++;
            }
          } else {
            const err6 = {
              instancePath: instancePath + '/breakBefore/' + i0,
              schemaPath: '#/properties/breakBefore/items/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err6];
            } else {
              vErrors.push(err6);
            }
            errors++;
          }
        }
        let i1 = data1.length;
        let j0;
        if (i1 > 1) {
          const indices0 = {};
          for (; i1--;) {
            let item0 = data1[i1];
            if (typeof item0 !== 'string') {
              continue;
            }
            if (typeof indices0[item0] == 'number') {
              j0 = indices0[item0];
              const err7 = {
                instancePath: instancePath + '/breakBefore',
                schemaPath: '#/properties/breakBefore/uniqueItems',
                keyword: 'uniqueItems',
                params: { i: i1, j: j0 },
                message:
                  'must NOT have duplicate items (items ## ' +
                  j0 +
                  ' and ' +
                  i1 +
                  ' are identical)',
              };
              if (vErrors === null) {
                vErrors = [err7];
              } else {
                vErrors.push(err7);
              }
              errors++;
              break;
            }
            indices0[item0] = i1;
          }
        }
      } else {
        const err8 = {
          instancePath: instancePath + '/breakBefore',
          schemaPath: '#/properties/breakBefore/type',
          keyword: 'type',
          params: { type: 'array' },
          message: 'must be array',
        };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
  } else {
    const err9 = {
      instancePath,
      schemaPath: '#/type',
      keyword: 'type',
      params: { type: 'object' },
      message: 'must be object',
    };
    if (vErrors === null) {
      vErrors = [err9];
    } else {
      vErrors.push(err9);
    }
    errors++;
  }
  validate24.errors = vErrors;
  return errors === 0;
}
validate24.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
