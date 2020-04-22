import * as fs from 'fs';
import * as path from 'path';
import * as dagPB from 'ipld-dag-pb';
import * as ix from 'ix/asynciterable';
import { filter, flatMap, map, scan, takeLast, pluck } from 'ix/asynciterable/operators';
import { omit, pathOr } from 'ramda';

const readDag = async filename=>{
  const content = fs.readFileSync(filename, {flag: 'r'});
  try {
    
    const dag = dagPB.util.deserialize(content)

    return dag.toJSON();
  } catch (error) {
    return null;
  }
}

async function searchBlock(repoPath) {

  const src = await fs.promises.opendir(repoPath);

  const results = ix.from(src).pipe(
    filter(dir=>dir.isDirectory()),
    flatMap(async (dir: fs.Dirent) => {        
        const filepath = path.join(repoPath, dir.name)

        const src2 = await fs.promises.opendir(filepath);
        return ix.from(src2).pipe(
          map(x=> x.name||undefined),
          map(filename=> ({
            filename,
            filepath
          })
        ),
      );
    }),
    filter(x=>!!x),
    map(data=>({
      ...data,
      name: path.basename(data.filename,'.data')
    })),
    scan(async (acc: {block, largestStr}, data)=>{

      process.stdout.write("Processing " + data.filepath + acc.largestStr + "\r");      
      
      const dag = await readDag(path.join(data.filepath, data.filename));
      if(!dag) return acc;
      
      if(pathOr(0,['block', 'dag', 'size'], acc)>dag.size) return acc
     
      return {block: {...data, dag}, largestStr: ", Largest is " + data.name+' with sizeof '+ dag.size/1000000+'MB'};

    }, {block:null, largestStr:null}),
    takeLast(1),
    pluck('block'),
  ) as ix.AsyncIterableX<{
    filename: string;
    filepath: string;
    name: string;
    dag: {};
  }>
  

  for await (const block of results ) {
    process.stdout.write("\n");      
    console.dir(omit(['dag'],block));
    console.dir(block.dag);
    console.log('DONE')
  }

}

searchBlock(path.join(
  require('os').homedir(),
  '.ipfs/blocks'
  )
).catch(console.error);