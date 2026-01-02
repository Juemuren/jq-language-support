# 将 不搓玉/不卖玉 转换为 搓玉/卖玉

def update_description:
  .description = "搓玉/卖玉";

def update_manufacture($index; $operators):
  .rooms.manufacture[$index].product = "Originium Shard" |
  .rooms.manufacture[$index].operators = $operators;

def update_trading($index):
  .rooms.trading[$index].product = "Orundum";

update_description |

.plans |= map(
  update_description |
  if .name == "早班" then
    update_manufacture(0; ["艾雅法拉", "地灵", "炎熔"]) |
    update_trading(0)
  elif .name == "晚班" then
    update_manufacture(0; ["火神", "泡泡", "褐果"]) |
    update_trading(0)
  end
)
