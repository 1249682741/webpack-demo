export default function add(...args) {
  return args.reduce((p, c) => p + c)
}
