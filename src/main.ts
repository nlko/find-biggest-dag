import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { decode, code as DAG_PB_CODE } from '@ipld/dag-pb';
import { CID } from 'multiformats/cid';
import * as Digest from 'multiformats/hashes/digest';
import { base32upper } from 'multiformats/bases/base32';

// Max number of blocks read at the same time.
const CONCURRENCY = 128;
const PROGRESS_INTERVAL_MS = 200;

const totalSize = (content: Uint8Array, node: ReturnType<typeof decode>) =>
  content.length + node.Links.reduce((sum, link) => sum + (link.Tsize ?? 0), 0);

const readDag = async filename=>{
  const content = await fs.promises.readFile(filename);
  try {
    const node = decode(content)
    return {...node, size: totalSize(content, node)};
  } catch (error) {
    return null;
  }
}

// Same result as readDag(filename)?.size, without reading whole leaf blocks.
// A valid dag-pb block starts with the key of a Links (0x12) or Data (0x0a)
// field. A block starting with Data and holding nothing else has no links, so
// its size is its file size and only the header needs reading. Anything else
// is small (links only) or invalid, and goes through the full decode.
const readDagSize = async (filename: string): Promise<number | null> => {
  const file = await fs.promises.open(filename, 'r');
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    // An empty block is a valid node with no Data and no Links.
    if (bytesRead === 0) return 0;
    if (header[0] !== 0x0a && header[0] !== 0x12) return null;

    if (header[0] === 0x0a) {
      let dataLength = 0, shift = 0, i = 1;
      for (; i < bytesRead; i++) {
        dataLength += (header[i] & 0x7f) * 2 ** shift;
        shift += 7;
        if (!(header[i] & 0x80)) break;
      }
      const dataEnd = i + 1 + dataLength;
      const { size } = await file.stat();
      if (dataEnd === size) return size;
      if (dataEnd > size) return null;
    }

    const content = await file.readFile();
    try {
      return totalSize(content, decode(content));
    } catch (error) {
      return null;
    }
  } finally {
    await file.close();
  }
}

// flatfs names blocks with the base32upper (no prefix) of the multihash.
// Every block kept here is dag-pb, so a sha2-256 hash gives a CIDv0 (Qm…).
const blockCid = (name: string) => {
  const digest = Digest.decode(base32upper.baseDecode(name));
  return digest.code === 0x12
    ? CID.createV0(digest as Digest.Digest<0x12, number>)
    : CID.createV1(DAG_PB_CODE, digest);
}

// Yields every block file of the flatfs repo, one shard directory at a time.
async function* listBlocks(repoPath: string) {
  for await (const dir of await fs.promises.opendir(repoPath)) {
    if (!dir.isDirectory()) continue;
    const filepath = path.join(repoPath, dir.name);
    for await (const file of await fs.promises.opendir(filepath)) {
      yield {filename: file.name, filepath, name: path.basename(file.name, '.data')};
    }
  }
}

async function searchBlock(repoPath) {

  type Block = {filename: string, filepath: string, name: string, size: number};
  let largest: Block = null;
  let lastProgress = 0;

  // CONCURRENCY workers share one generator: each next() call hands out a
  // different block. ix's concurrent flatMap costs ~0.2ms per item, more than
  // the read itself, so the pool is written by hand.
  const blocks = listBlocks(repoPath);
  await Promise.all(Array.from({length: CONCURRENCY}, async () => {
    for await (const data of blocks) {
      const size = await readDagSize(path.join(data.filepath, data.filename));
      if (size === null) continue;

      // Ties are broken by name so the result doesn't depend on read order.
      if (!largest || size > largest.size || (size === largest.size && data.name > largest.name)) {
        largest = {...data, size};
      }

      const now = Date.now();
      if (now - lastProgress >= PROGRESS_INTERVAL_MS) {
        lastProgress = now;
        process.stdout.write("Processing " + data.filepath + ", Largest is " + largest.name + ' with sizeof ' + largest.size/1000000 + 'MB' + "\r");
      }
    }
  }));

  if (largest) {
    const { size: _size, ...block } = largest;
    process.stdout.write("\n");
    console.dir(block);
    console.dir(await readDag(path.join(block.filepath, block.filename)));
    const cid = blockCid(block.name).toString();
    console.log('CID:', cid);
    console.log(`Restore MFS root with: ipfs files chroot --confirm ${cid}`);
    console.log('DONE')
  }

}

searchBlock(path.join(
  os.homedir(),
  '.ipfs/blocks'
  )
).catch(console.error);