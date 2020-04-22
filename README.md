# Search in the $HOME/.ipfs/blocks the biggest dag

I created this piece of code to find the block containing the mfs root in a broken IPFS folder.

I knew in my case the biggest dag would be the mfs root but it's probably not the case all the time.

It takes several minutes has it will read all the block of the repo (70 GB repo takes about 5 minutes).

## Usage

```
yarn install 
yarn start
```

