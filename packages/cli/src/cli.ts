#!/usr/bin/env node
import "flex-tools/string"
import { LiteEvent, LiteEventSubscriber } from "flex-tools/events/liteEvent"
import { Command,Option } from "commander"
import logsets  from "logsets"
// @ts-ignore
import replaceAll  from 'string.prototype.replaceall'
import { assignObject } from "flex-tools/object/assignObject"
import { FlexCommand } from "./command"
import { fixIndent } from './utils';
import { findCommands } from "./finder"
replaceAll.shim() 


export interface FlexCliOptions{
    name:string,
    title?:string,
    description?:string,
    version?:string
    // 定义显示帮助信息
    logo?:string | [ 'beforeAll'|'afterAll'|'before'|'after',string],
    // 在根命令执行前执行==commander的preAction
    before?:(thisCommand:Command,actionCommand:Command)=>void,
    // 在根命令执行后执行==commander的postAction
    after?:(thisCommand:Command,actionCommand:Command)=>void, 
    // flexcli运行时会在当前工程的package.json的依赖中查找以prefix/开头的包，然后自动加载其cli目录下的命令
    // 例如：prefix=myapp，则会自动加载flex-cli-xxx包中的cli目录下的命令
    // 如prefix=myapp, cliPath="cmds",则会自动加载flex-cli-xxx包中的cmds目录下的命令
    include?:string | RegExp | string[] | RegExp[],
    // 忽略查找正则表达式
    exclude?:string | RegExp | string[] | RegExp[],
    // flexcli会在当前工程的以prefix/开头下查找命令声明
    // / pattern默认值是cli，即会在当前工程的以prefix/开头的包下查找cli目录下的命令
    // 指定cli所在的目录,默认值是cli,要遍历该目录下的所有js文件作为命令导出
    cliDir?:string            
    context?:Record<string,any>             // 传递给命令的上下文，当使用        
}

 
  

export type FlexCliCommand = (cli:FlexCli)=>FlexCommand | FlexCommand[] | void


export type FlexCliEvents = 
    "register"              // 当命令注册时触发

export class FlexCli extends LiteEvent<any,FlexCliEvents>{
    options:FlexCliOptions 
    root!:Command                       
    constructor(options?:FlexCliOptions){
        super()
        this.options= assignObject({
            name:"flexcli",
            package:null,
            cliDir:"cli",
        },options)   
        this.createRootCommand()
        this.addLogo()
        this.installExtendCommands()        
    } 
    get name(){return this.options.name}
    /**
     * 是否禁用了所有的交互提示
     */
    get isDisabledPrompts(){
        return(this.root as any).rawArgs.includes("--no-prompts")    
    }    
    /**
     * 显示在logo
     */
    private addLogo(){
        const [pos,text] = Array.isArray(this.options.logo) ?this.options.logo : ["beforeAll",this.options.logo] as [ 'beforeAll'|'afterAll'|'before'|'after',string]
        this.addHelp(text,{pos})
    } 
    /**
     * 扫描当前工程的依赖，加载匹配include的依赖下的命令
     */
    private installExtendCommands(){
        const cmders = findCommands(this)
        for(let cmder of cmders){
            try{
                if(typeof(cmder)==="function"){
                    let cmds = cmder(this)
                    cmds =cmds ?  (Array.isArray(cmds) ? cmds : [cmds]) : []
                    this.register(()=>cmds) 
                }
            }catch(e:any){
            }
        }
    } 
    /**
     * 创建根命令
     * 
     */
    private createRootCommand(){
        this.root = new Command();
        this.root.name(this.name)
            .helpOption('-h, --help', '显示帮助')     
            .version(require("../package.json").version,"-v, --version","当前版本号") 
            .action(()=>{                
                if(this.options.title) logsets.log(this.options.title)
                logsets.log("版本号:{}",require("../package.json").version)
                this.root.help()                
            })
        if(this.options.before) this.root.hook('preAction',this.options.before)
        if(this.options.after) this.root.hook('postAction',this.options.after) 
    } 
    /**
     * 添加帮助选项
     * 
     * @param text      帮助文本
     * @param position  显示位置，可选值：before|after|beforeAll|afterAll
     * @param fixIndent   是否自动修正缩进，如果为true，则会自动修正缩进，当显示多行时文本时，会自动修正缩进
     * 
     */
    public addHelp(text:string,{pos='beforeAll',alignIndent=true}:{pos:'before'|'after' | 'beforeAll' | 'afterAll',alignIndent?:boolean | number}){
        if(alignIndent) text = fixIndent(text,alignIndent)
        this.root.addHelpText(pos,text)
    }


    /**
     * 注册一个命令
     * @param cmd 
     */
    register(cmd:FlexCliCommand){
        if(typeof(cmd)=="function"){
            let result = cmd(this)
            let cmds = result instanceof Array ? result : (result==undefined ? [] :  [result])
            for(let cmd of cmds){
                if(cmd instanceof FlexCommand){
                    this.root.addCommand(cmd) 
                    this.emit("register",cmd.fullname,true)
                }
            }                        
        }else{
            logsets.error("无效的FlexCliCommand")
        }        
    }
    /**
     * 根据命令名称查找命令
     * 
     * @remarks
     * 
     * find("dev")
     * find("dev.microservice")  支持多级命令
     * find("abc",DevCommand)  允许指定从DevCommand下开始查找abc命令
     * 
     * @param name 
     */
    get(name:string):FlexCommand | undefined{
        const names=name.split(".")
        let curCmd:Command = this.root
        let resultCmd:FlexCommand | undefined
        while(names.length>0){
            const topName = names.shift()
            const r = curCmd.commands.find(c=>c.name()==topName)  as FlexCommand
            if(r && names.length==0){
                resultCmd = r
            }
            curCmd = r
        }     
        return resultCmd    
    }
    /**
     * 查找一个命令
     * 
     * 如果命令不存在，则等待命令注册后再返回
     * 
     * 在多包场景下，如果命令在其他包中注册并且该包中的命令还没注册，则会等待命令注册后再返回
     * 
     * @param name 
     * @returns 
     */
    find(name:string):Promise<FlexCommand | undefined>{
        return new Promise<FlexCommand | undefined>((resolve)=>{
            let listener:LiteEventSubscriber
            listener = this.on("register",(fullname:string)=>{
                if(fullname==name){
                    listener.off()
                    resolve(this.get(name))
                }
            },{objectify:true}) as LiteEventSubscriber
        })
    }
    /**
     * 判断命令是否存在
     * 
     * @param name 
     * @returns 
     */
    exists(name:string):boolean{
        if(name in this.root.commands){
            return true
        }else{
            return this.get(name) != undefined
        }
    }     

    /**
     * 运行命令行程序
     */
    run(){ 
        this.root.parseAsync(process.argv);              
    }
    /**
     * 创建一个命令
     * 
     * 
     */
    create(){
    }
}
 