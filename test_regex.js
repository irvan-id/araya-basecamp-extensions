const regex = /\/(projects|buckets)\/\d+(\?.*|#.*)?$/;
console.log(regex.test("https://3.basecamp.com/5526083/buckets/42668547/card_tables/cards/9540937883"));
console.log(regex.test("/5526083/buckets/42668547/card_tables/cards/9540937883"));
console.log(regex.test("https://3.basecamp.com/5526083/buckets/42668547"));
