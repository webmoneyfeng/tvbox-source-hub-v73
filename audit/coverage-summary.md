# v7.3 覆盖率与缺片根因审计

- 基准入口：https://tv.webhome.eu.org
- 生成时间：2026-07-06T06:48:07.560Z
- PASS/WARN/FAIL：6/4/0
- 根因分布：SOURCE_PHYSICAL_LIMIT=1，OK=6，RANKING_SUPPRESSION=3

## 重点条目
- WARN｜天道｜SOURCE_PHYSICAL_LIMIT｜源命中 9｜详情 OK｜播放 OK｜重复搜索结果不稳定，可能由源超时或反爬导致。
- PASS｜亮剑｜OK｜源命中 9｜详情 OK｜播放 OK｜
- PASS｜潜伏｜OK｜源命中 11｜详情 OK｜播放 OK｜
- PASS｜流浪地球｜OK｜源命中 9｜详情 OK｜播放 OK｜
- PASS｜哪吒之魔童降世｜OK｜源命中 15｜详情 OK｜播放 OK｜
- PASS｜航拍中国｜OK｜源命中 6｜详情 OK｜播放 OK｜
- PASS｜乘风破浪的姐姐｜OK｜源命中 16｜详情 OK｜播放 OK｜
- WARN｜演唱会｜RANKING_SUPPRESSION｜源命中 9｜详情 OK｜播放 OK｜已召回但精确结果未稳定进入第一页。
- WARN｜电影解说｜RANKING_SUPPRESSION｜源命中 2｜详情 OK｜播放 OK｜已召回但精确结果未稳定进入第一页。
- WARN｜短剧｜RANKING_SUPPRESSION｜源命中 13｜详情 OK｜播放 OK｜已召回但精确结果未稳定进入第一页。
