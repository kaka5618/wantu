const app = getApp()
Page({
  data:{photoPath:'',generatedImageUrl:'',state:'loading',loadingTitle:'AI 正在读懂这张照片',loadingDetail:'通常需要约 40–90 秒，请保持页面打开',errorMessage:'',saved:false,saving:false},
  onLoad(){const photoPath=app.globalData.currentStoryPhoto;if(!photoPath)return wx.navigateBack();this.setData({photoPath});this.start(photoPath)},
  onUnload(){clearTimeout(this.timer);clearInterval(this.progress)},
  start(photoPath){this.startedAt=Date.now();clearInterval(this.progress);this.progress=setInterval(()=>this.updateProgress(),1000);wx.cloud.uploadFile({cloudPath:`story-source/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,filePath:photoPath,success:r=>wx.cloud.callFunction({name:'generateStory',data:{fileId:r.fileID},success:x=>this.handleStart(x.result||{}),fail:()=>this.fail('AI 服务调用失败，请稍后再试。')}),fail:()=>this.fail('照片上传失败，请稍后再试。')})},
  handleStart(r){if(r.ok&&r.pending)return this.poll(r.taskId);if(r.code==='CREDITS_EXHAUSTED')return wx.redirectTo({url:'/pages/credits/credits'});this.fail(r.message||'这次没有生成成功，请重试。')},
  poll(taskId){this.timer=setTimeout(()=>wx.cloud.callFunction({name:'generateStory',data:{action:'poll',taskId},success:x=>{const r=x.result||{};if(r.ok&&r.pending)return this.poll(taskId);if(r.ok&&r.imageUrl)return this.ready(r.imageUrl);this.fail(r.message||'这次没有生成成功，请重试。')},fail:()=>this.poll(taskId)}),2500)},
  updateProgress(){const s=Math.floor((Date.now()-this.startedAt)/1000);if(s>=80)this.setData({loadingTitle:'正在画最后的细节',loadingDetail:'故事正在自然连到照片里，请再等一会儿'});else if(s>=40)this.setData({loadingTitle:'AI 正在续写这个故事',loadingDetail:`已经创作 ${s} 秒，通常很快就完成啦`});else if(s>=12)this.setData({loadingTitle:'AI 正在寻找故事线索',loadingDetail:'正在让真实照片和手绘世界自然相连'})},
  ready(url){clearInterval(this.progress);this.setData({state:'ready',generatedImageUrl:url})},fail(message){clearInterval(this.progress);this.setData({state:'failed',errorMessage:message})},
  save(){this.setData({saving:true});wx.cloud.downloadFile({fileID:this.data.generatedImageUrl}).then(r=>new Promise((ok,no)=>wx.saveImageToPhotosAlbum({filePath:r.tempFilePath,success:ok,fail:no}))).then(()=>{this.setData({saved:true});wx.showToast({title:'已保存到相册',icon:'success'})}).catch(()=>wx.showToast({title:'保存失败，请稍后再试',icon:'none'})).finally(()=>this.setData({saving:false}))},
  regenerate(){wx.showModal({title:'换一个故事？',content:'会消耗 1 次体验机会，继续吗？',success:r=>{if(r.confirm){this.setData({state:'loading',generatedImageUrl:'',saved:false});this.start(this.data.photoPath)}}})}
})
