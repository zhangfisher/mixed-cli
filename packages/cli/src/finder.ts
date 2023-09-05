import { getPackageRootPath } from 'flex-tools';
import type { FlexCli } from './cli';
import {  globSync } from 'glob'
import { FlexCliCommand } from './cli';

/**
 * 
 * 在当前工程中查找符合FlexCli.prefix约定的命令 
 *  
 * - 读取当前包的package.json
 * - 找出所有以cli.prefix开头的依赖
 * - 加载这些依赖的目录下的匹配cli.pattern的命令
 * - 加载加载这样命令
 * 
 */

const fs = require("node:fs")
const path = require("node:path")
const { getPackageJson } = require("flex-tools/package/getPackageJson")
 

export function getMatchedDependencies(this:FlexCli,entry:string):string[]{
    const pacakgeMacher = this.options.include
    if(!(pacakgeMacher instanceof RegExp)) return  []
    
    // 找出当前包的所有依赖
    const { dependencies={},devDependencies={},peerDependencies={},optionalDependencies={},bundleDependencies={} } = getPackageJson(entry)
    const packageNames = [
        ...Object.keys(dependencies),
        ...Object.keys(devDependencies),
        ...Object.keys(peerDependencies),
        ...Object.keys(optionalDependencies),
        ...Object.keys(bundleDependencies)
    ]
    return packageNames.filter(name=>name!=="@voerka/cli" && pacakgeMacher.test(name))
}

function isMatched(str:string,reg?:string | RegExp | string[] | RegExp[]):boolean{
    // let regexps:RegExp[]=[]
    const regexps = reg ? (Array.isArray(reg) ? reg : [reg]) : []
    return regexps.some(regexp=>{
        if(typeof regexp === "string"){
            return (new RegExp(regexp)).test(str)
        }else if(regexp instanceof RegExp){
            return regexp.test(str)
        }else{
            return false
        }
    })
}

export function findCliPaths(this:FlexCli,packageName?:string ,entry?:string):string[]{
    const includeMacher = this.options.include
    const excludeMacher = this.options.exclude
    if(!includeMacher) return []
    const packageRoot = getPackageRootPath(entry || process.cwd())
    const packagePath = packageName ? path.dirname(require.resolve(packageName,{paths:[packageRoot as string]})) : packageName

    // 找出当前包的所有依赖
    const packageNames = getMatchedDependencies.call(this,packagePath)

    const cliDirs:string[]=[]
    
    if(entry!==undefined) cliDirs.push(path.join(packagePath,this.options.cliDir))
    packageNames.filter(name=>{
            return  isMatched(name,includeMacher) && !isMatched(name,excludeMacher) 
        })
        .forEach(packageName=>{
            try{
                const packageEntry = path.dirname(require.resolve(packageName,{paths:packagePath ? [packagePath] : [process.cwd()]}))
                const packageCliDir =path.join(packageEntry,this.options.cliDir)
                if(fs.existsSync(packageCliDir)){
                    cliDirs.push(packageCliDir)
                }
                // 查找当前包的所属工程的依赖
                let dependencies = getMatchedDependencies.call(this,packageEntry)
                cliDirs.push(...dependencies.reduce<string[]>((result,dependencie)=>{
                    result.push(...findCliPaths.call(this,dependencie,packageEntry))
                    return result
                },[]))
            }catch(e:any){
                ///console.error(e.stack)
            }    
        })
    return cliDirs 
}

/**
 * 
 *  扫描当前工程中所有符合条件的命令
 * 
 * @param cli 
 * 
 */
export function findCommands(cli:FlexCli){ 
    const cliDirs =  findCliPaths.call(cli)
    const commands:FlexCliCommand[] = []
    cliDirs.forEach(dir=>{
        globSync("*.js",{
            cwd:dir,
            absolute :true
        }).forEach((file:string)=>{
            try{
                commands.push(require(file))
            }catch(e:any){
                console.error(e)
            }
        })        
    })
    return commands
}

