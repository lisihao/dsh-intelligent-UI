/** Synthetic acceptance material, not a product benchmark or real research claim. */
export const REPORT = `# 长上下文推理架构研究

这是合成验收材料，用于检查研究组件，不代表真实产品评测。

## 核心发现

方案 B 在本组测试中的显存占用更低。

仅适用于：单卡 · 8K 上下文 · BF16 · 并发 8。

## 实验记录

下表为示意数据。来源：[示意实验记录 R1](https://example.test/research/r1)。

| 方案 | 显存（GB） | 吞吐（tok/s） | 测试条件 |
|---|---:|---:|---|
| 方案 A | 48 | 110 | 8K · BF16 · 并发 8 |
| 方案 B | 36 | 104 | 8K · BF16 · 并发 8 |
| 方案 C | 44 | — | 16K · FP8 · 并发 8 |

方案 C 的测试条件不同，不纳入本组直接比较。

## 限定与另一种解释

显存占用降低不能直接推出总成本降低。

尚缺相同条件下的延迟、稳定性和部署成本证据。

硬件价格、实际服务负载和工程开销也会影响部署取舍。

## 后续核查

需要核查显存差异在其他输入分布下是否仍然存在。
`
export function analysis(reportHash) {
 return {formatVersion:1,reportHash,question:'哪种推理方案更适合给定的长上下文服务？',claims:[
  {id:'memory',text:'方案 B 在本组测试中的显存占用更低。',kind:'observation',anchor:{quote:'方案 B 在本组测试中的显存占用更低。'},conditions:['单卡','8K 上下文','BF16','并发 8'],evidence:[{id:'memory-row',relation:'support',anchor:{quote:'| 方案 B | 36 | 104 | 8K · BF16 · 并发 8 |'},sourceUrl:'https://example.test/research/r1',note:'报告示意表格，外部原文尚未核查。'},{id:'different-scope',relation:'limitation',anchor:{quote:'方案 C 的测试条件不同，不纳入本组直接比较。'},note:'不同条件的结果不直接排序。'}],openQuestions:['相同条件下，端到端延迟是否变化？']},
  {id:'cost',text:'显存占用降低不能直接推出总成本降低。',kind:'inference',anchor:{quote:'显存占用降低不能直接推出总成本降低。'},conditions:['总成本需要额外证据'],evidence:[{id:'missing-cost',relation:'challenge',anchor:{quote:'尚缺相同条件下的延迟、稳定性和部署成本证据。'},note:'这是对直接外推成本结论的限制，不是已证明成本上升。'}],openQuestions:['部署密度改善能否抵消其他成本？']},
  {id:'hypothesis',text:'实际服务负载可能改变方案取舍。',kind:'hypothesis',anchor:{quote:'硬件价格、实际服务负载和工程开销也会影响部署取舍。'},conditions:['需要实际服务负载的验证'],evidence:[],openQuestions:['更换输入分布后，显存差异是否仍然存在？']}
 ]}
}
