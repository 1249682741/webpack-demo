const fs = require('fs')
const { dirname, join } = require('path')
// 主要使用 parser.parse 将 ES6 代码转成抽象语法树
const parser = require('@babel/parser')
// 使用 traverse 遍历 ES6 代码的抽象语法树，找出当前 JS 文件所有依赖文件路径
const traverse = require('@babel/traverse').default
// 使用 transformFromAstSync 将 ES5 的抽象语法树转换成 ES5 代码
const { transformFromAstSync } = require('@babel/core')

function genBundle(entryPath) {
  // 1.1 首先创建入口文件模块信息. 入口文件所有依赖文件路径->入口文件ES6转ES5代码
  const entryModule = getModule(entryPath)
  // 1.2 之后从入口文件开始递归创建所有模块的依赖关系图(字符串)。每个模块依赖关系既模块路径与模块内部代码之间的映射关系：
  // `
  //   {
  //     './index.js'      : some string_code ~,
  //     './math/index.js' : some string_code ~,
  //     './tools/add.js'  : some string_code ~,
  //     './tools/mul.js'  : some string_code ~,
  //   }
  // `
  const graph = `{${getGraph(entryModule, entryPath)}}`
  // 1.3 返回一个立即执行函数字符串，既打包后的代码块：
  // 立即执行函数参数既模块依赖关系图，且立即执行函数内部实现了类CJS的require, 即可根据模块路径找到对应模块代码执行
  // 当立即执行函数运行，我们会从入口文件路径开始require, 执行入口文件内部代码，遇到require依赖模块，因为注入了实现的类CJS的require
  // 所以会继续执行当前依赖模块代码，最终所有模块代码执行将完毕
  return `(function(modules){
    function require(path){
      const module= {exports:{}}
      modules[path](require,module,module.exports)
      return module.exports
    }
    require('${entryPath}')
  })(${graph})`
}

function getModule(path) {
  // 1. 根据文件路径读取对应文件内容
  const content = fs.readFileSync(path, 'utf-8')
  // 2. 将文件内容ES6转换成抽象语法树（AST）
  const ast = parser.parse(content, { sourceType: 'module' })
  // 3. 在抽象语法树中找到当前文件所有依赖的文件路径保存
  const dependencies = []
  traverse(ast, {
    ImportDeclaration: ({ node }) => {
      dependencies.push(node.source.value)
    },
  })
  // 4. 将当前文件的语法树转成ES5代码，并添加函数体包裹，模拟CJS中的require行为
  const code = `function (require, module, exports) {
    ${transformFromAstSync(ast, undefined, { presets: ['@babel/preset-env'] }).code}
  }`
  // 5. 返回当前文件的模块信息：文件路径，所有依赖的文件路径，函数体包裹的 ES6 转成 ES5后的代码
  return { path, dependencies, code }
}

function getGraph(module, path) {
  // 1. 首先创建当前模块的路径与代码映射关系：
  // `'./index.js': some code ~,`
  const initialMappingCodeToPath = `'${path}': ${module.code},`
  // 2. 递归处理当前模块的依赖，创建所有模块的路径与代码映射关系，最终合并在一起（字符串）， 像下面这样
  // `
  //     './index.js'        : some string_code ~ ,
  //     './math/index.js'    : some string_code ~ ,
  //     './tools/add.js'     : some string_code ~ ,
  //     './tools/mul.js'     : some string_code ~ ,
  // `
  return module.dependencies.reduce(
    (mappingCodeToPath, depPath) => {
      // 2.1 根据当前模块的路径获取依赖模块的绝对路径
      const depAbspath = join(dirname(module.path), depPath)
      // 2.2 获取依赖模块的路径与代码映射关系
      const depMappingCodeToPath = getGraph(getModule(depAbspath), depPath)
      // 2.3 合并所有模块的路径与代码映射关系，生成依赖关系图
      return mappingCodeToPath + depMappingCodeToPath
    },
    // 2.4 reduce方法初始模块的路径与代码映射关系
    initialMappingCodeToPath
  )
}

// 1. 开始打包
// 传入入口文件路径，开始打包
const bundle = genBundle('./index.js')

// 4. 按照webpack，最后会将打包后的代码注入到dist文件夹下面的bundle.js中既完成打包
!fs.existsSync('./dist') && fs.mkdirSync('./dist') // 若没有dist文件夹就创建dist文件夹
fs.writeFileSync('./dist/bundle.js', bundle)
