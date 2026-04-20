import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Header } from "@/components/butchery/Header";
import { POS } from "@/components/butchery/POS";
import { ProductsManager } from "@/components/butchery/ProductsManager";
import { OpeningStock } from "@/components/butchery/OpeningStock";
import { DailyReport } from "@/components/butchery/DailyReport";
import { PurchaseOrders } from "@/components/butchery/PurchaseOrders";
import { Transactions } from "@/components/butchery/Transactions";
import {
  ShoppingCart,
  Package,
  Beef,
  BarChart3,
  Truck,
  ReceiptText,
} from "lucide-react";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-6">
        <Tabs defaultValue="pos" className="space-y-6">
          <TabsList className="grid grid-cols-3 sm:grid-cols-6 w-full h-auto p-1 gap-1">
            <TabsTrigger value="pos" className="gap-1.5 py-2.5 text-xs sm:text-sm">
              <ShoppingCart className="h-4 w-4" />
              POS
            </TabsTrigger>
            <TabsTrigger value="purchases" className="gap-1.5 py-2.5 text-xs sm:text-sm">
              <Truck className="h-4 w-4" />
              <span className="hidden sm:inline">Purchases</span>
              <span className="sm:hidden">PO</span>
            </TabsTrigger>
            <TabsTrigger value="stock" className="gap-1.5 py-2.5 text-xs sm:text-sm">
              <Package className="h-4 w-4" />
              Stock
            </TabsTrigger>
            <TabsTrigger value="transactions" className="gap-1.5 py-2.5 text-xs sm:text-sm">
              <ReceiptText className="h-4 w-4" />
              <span className="hidden sm:inline">History</span>
              <span className="sm:hidden">Tx</span>
            </TabsTrigger>
            <TabsTrigger value="report" className="gap-1.5 py-2.5 text-xs sm:text-sm">
              <BarChart3 className="h-4 w-4" />
              Report
            </TabsTrigger>
            <TabsTrigger value="products" className="gap-1.5 py-2.5 text-xs sm:text-sm">
              <Beef className="h-4 w-4" />
              <span className="hidden sm:inline">Products</span>
              <span className="sm:hidden">Items</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pos"><POS /></TabsContent>
          <TabsContent value="purchases"><PurchaseOrders /></TabsContent>
          <TabsContent value="stock"><OpeningStock /></TabsContent>
          <TabsContent value="transactions"><Transactions /></TabsContent>
          <TabsContent value="report"><DailyReport /></TabsContent>
          <TabsContent value="products"><ProductsManager /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;
