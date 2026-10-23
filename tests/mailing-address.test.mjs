import test from "node:test";
import assert from "node:assert/strict";
import { mailingAddressProblem } from "../src/lib/mailing-address.ts";

test("P0-1 页脚实体地址：拒绝空值、占位文本、纯邮箱/网址/电话和过短文本", () => {
  for (const value of [
    "",
    "   ",
    "Sender's contact information",
    "Sender’s contact information",
    "SENDER CONTACT INFO",
    "Your address here",
    "Your mailing address",
    "Address goes here, City",
    "123 Example Street, Placeholder City",
    "发件人联系地址",
    "发件人联系方式：微信 abc",
    "请填写真实的联系地址",
    "填写真实的联系地址",
    "您的地址待补充",
    "XX省XX市XX路XX号",
    "某某市某某区某某路 1 号",
    "shop@example.com",
    "support@shop.cn",
    "https://shop.example.com/contact",
    "www.myshop.com",
    "+86 138-0000-0000",
    "12345678",
    "上海",
    "地址",
    "N/A",
  ]) {
    assert.notEqual(mailingAddressProblem(value), null, value);
  }
  assert.equal(mailingAddressProblem(null), "请填写邮件页脚实体地址");
  assert.match(
    mailingAddressProblem("Sender's contact information"),
    /占位文本/,
  );
  assert.match(mailingAddressProblem("shop@example.cn"), /邮箱/);
});

test("P0-1 页脚实体地址：接受真实的中英文地址", () => {
  for (const value of [
    "上海市测试路 1 号",
    "上海市徐汇区漕溪北路 88 号 12 楼，中国",
    "88 Caoxi North Rd, Xuhui, Shanghai, China",
    "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
    "PO Box 1234, Austin, TX 78701",
    "深圳市南山区科技园科苑路 15 号",
    "Calle Sendero 12, Madrid, España",
    "Exxon Tower, 5959 Las Colinas Blvd, Irving, TX",
  ]) {
    assert.equal(mailingAddressProblem(value), null, value);
  }
});
