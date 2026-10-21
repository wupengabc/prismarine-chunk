/* eslint-env mocha */

const assert = require('assert')
const loadChunk = require('..')

// Independent PalettedContainer wire fixture: no chunk block counts or block data.
function biomeBuffer (values, bits, noSizePrefix) {
  if (bits === 0) return Buffer.from(noSizePrefix ? [0, values[0]] : [0, values[0], 0])
  const palette = [...new Set(values)]
  const direct = bits > 3
  const perLong = Math.floor(64 / bits)
  const longs = Math.ceil(64 / perLong)
  const header = [bits, ...(!direct ? [palette.length, ...palette] : []), ...(!noSizePrefix ? [longs] : [])]
  const data = Buffer.alloc(longs * 8)
  for (let i = 0; i < longs; i++) {
    let word = 0n
    for (let j = 0; j < perLong && i * perLong + j < 64; j++) {
      const value = values[i * perLong + j]
      word |= BigInt(direct ? value : palette.indexOf(value)) << BigInt(j * bits)
    }
    data.writeBigUInt64BE(word, i * 8)
  }
  return Buffer.concat([Buffer.from(header), data])
}

describe('serialized chunk biome updates', function () {
  for (const version of ['1.18', '1.21.4', '1.21.5', '26.2', '26.3']) {
    const registry = require('prismarine-registry')(version)
    const Chunk = loadChunk(registry)
    const noSizePrefix = registry.version['>=']('1.21.5')

    it(`${version}: decodes single, indirect and direct palettes without changing blocks or lights`, function () {
      const chunk = new Chunk({ minY: -32, worldHeight: 48 })
      const point = { x: 5, y: -28, z: 9 }
      chunk.setBlockStateId(point, registry.blocksByName.stone.defaultState)
      chunk.setSkyLight(point, 13)
      chunk.setBlockLight(point, 7)
      const sections = chunk.sections.slice()
      const light = chunk.dumpLight()
      const indirect = Array.from({ length: 64 }, (_, i) => i % 3 + 1)
      const direct = Array.from({ length: 64 }, (_, i) => i % Object.keys(registry.biomes).length)
      const bits = chunk.maxBitsPerBiome
      chunk.loadBiomes(Buffer.concat([
        biomeBuffer([2], 0, noSizePrefix),
        biomeBuffer(indirect, 2, noSizePrefix),
        biomeBuffer(direct, bits, noSizePrefix)
      ]))
      for (let section = 0; section < 3; section++) {
        for (let i = 0; i < 64; i++) {
          const pos = { x: (i & 3) * 4, y: -32 + section * 16 + (i >> 4) * 4, z: ((i >> 2) & 3) * 4 }
          assert.strictEqual(chunk.getBiome(pos), section === 0 ? 2 : section === 1 ? indirect[i] : direct[i])
        }
        assert.strictEqual(chunk.sections[section], sections[section])
      }
      assert.strictEqual(chunk.getBlockStateId(point), registry.blocksByName.stone.defaultState)
      assert.deepStrictEqual(chunk.dumpLight(), light)
    })

    it(`${version}: rejects truncated, invalid and trailing data without partially replacing biomes`, function () {
      const chunk = new Chunk({ minY: -16, worldHeight: 32 })
      chunk.setBiome({ x: 0, y: -16, z: 0 }, 1)
      const before = chunk.biomes
      const valid = Buffer.concat([biomeBuffer([2], 0, noSizePrefix), biomeBuffer([3], 0, noSizePrefix)])
      for (const malformed of [Buffer.alloc(0), valid.subarray(0, -1), Buffer.from([9]), Buffer.concat([valid, Buffer.from([0])])]) {
        assert.throws(() => chunk.loadBiomes(malformed))
        assert.strictEqual(chunk.biomes, before)
        assert.strictEqual(chunk.getBiome({ x: 0, y: -16, z: 0 }), 1)
      }
      chunk.loadBiomes(valid)
      assert.strictEqual(chunk.getBiome({ x: 0, y: -16, z: 0 }), 2)
      assert.strictEqual(chunk.getBiome({ x: 0, y: 0, z: 0 }), 3)
    })
  }
})
